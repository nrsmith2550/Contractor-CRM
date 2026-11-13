import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, incident, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount } from "@/server/domain/accounts";
import { addNote, timeline } from "@/server/domain/activities";
import {
  cancelCase,
  convertToWorkOrder,
  createCase,
  createQueue,
  createSubject,
  getCase,
  listCases,
  listQueues,
  listSubjects,
  reactivateCase,
  resolveCase,
  setCaseStatus,
  updateCase,
} from "@/server/domain/cases";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { SLA_HOURS, slaDueAt, slaInfo } from "@/server/domain/sla";
import {
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  setWorkOrderStatus,
  updateWorkOrder,
} from "@/server/domain/work-orders";
import type { Email } from "@/server/email/mailer";
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const GHOST = "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11";

async function newBusiness() {
  const { key } = await mintLicense({ tier: "team", seatLimit: 20 });
  const id = rand();
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Sales Co ${id}`,
    ownerName: "Olive Owner",
    ownerEmail: `owner-${id}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return {
    tenantId: res.tenantId,
    ownerId: res.userId,
    admin: await buildCtx(res.tenantId, res.userId),
  };
}
type Biz = Awaited<ReturnType<typeof newBusiness>>;

/** Adds a user with one of the seeded roles, through the real invite and accept flow. */
async function addUser(biz: Biz, roleName: string): Promise<Ctx> {
  const role = (
    await withTenant(biz.tenantId, (tx) =>
      tx.select({ id: securityRole.id }).from(securityRole).where(eq(securityRole.name, roleName)),
    )
  )[0]!.id;
  const mail: Email[] = [];
  const email = `${roleName.replace(/\W/g, "").toLowerCase()}-${rand()}@example.test`;
  await inviteUser(
    { tenantId: biz.tenantId, inviterId: biz.ownerId, email, roleId: role },
    { send: async (e) => void mail.push(e), appUrl: "https://app.test" },
  );
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)![1]!;
  const res = await acceptInvitation({
    token,
    values: { fullName: roleName, password: PASSWORD, confirmPassword: PASSWORD },
    ip: `ip-${rand()}`,
  });
  if (!res.ok) throw new Error(`accept failed: ${res.code}`);
  return buildCtx(biz.tenantId, res.userId);
}

const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

const auditOf = (tenantId: string, recordId: string) =>
  withTenant(tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.recordId, recordId)));
const mkCase = async (c: Ctx, over: Record<string, unknown> = {}) =>
  must(await createCase(c, { title: "Furnace won't start", ...over })).case;
const caseStatus = async (c: Ctx, id: string) => must(await getCase(c, id)).case;

describe.skipIf(!enabled)("Phase 4 acceptance criteria", () => {
  it("Converting a case creates a linked Unscheduled work order", async () => {
    const { admin: c } = await newBusiness();
    const acct = must(
      await createAccount(c, {
        name: "Buyer Inc",
        addressStreet: "1 Main St",
        addressCity: "Pittsburgh",
        addressRegion: "PA",
        addressPostalCode: "15201",
      }),
    ).account;
    const k = await mkCase(c, {
      customerAccountId: acct.id,
      priority: "high",
      description: "Gate code 4411",
    });
    expect(k.ticketNumber).toBe("REQ-01001");

    const r = must(
      await convertToWorkOrder(c, k.id, { workOrderType: "repair", estDurationMin: 90 }),
    );
    expect(r.workOrder).toMatchObject({
      woNumber: "JOB-01001",
      status: "unscheduled",
      incidentId: k.id,
      serviceAccountId: acct.id,
      title: "Furnace won't start",
      priority: "high",
      instructions: "Gate code 4411",
      estDurationMin: 90,
      addressStreet: "1 Main St",
      addressCity: "Pittsburgh",
      addressPostalCode: "15201",
    });
    expect((await caseStatus(c, k.id)).status).toBe("in_progress"); // the case stays open
    expect((await auditOf(c.tenantId, k.id)).map((a) => a.action)).toContain("convert");
    // A case can have several visits.
    expect(
      must(await convertToWorkOrder(c, k.id, { title: "Follow-up visit" })).workOrder.woNumber,
    ).toBe("JOB-01002");
    expect(must(await listWorkOrders(c, { view: "unscheduled", incidentId: k.id })).total).toBe(2);
  });

  it("SLA timer shows breached state past due", async () => {
    const { admin: c, tenantId } = await newBusiness();
    const k = await mkCase(c, { priority: "urgent" });
    expect(k.slaDueAt!.getTime() - k.createdAt.getTime()).toBe(SLA_HOURS.urgent * 3_600_000);
    expect(slaInfo(k).state).toBe("on_track");

    // Push the due time into the past: the case is now breached, and the countdown is negative.
    await withTenant(tenantId, (tx) =>
      tx
        .update(incident)
        .set({ slaDueAt: new Date(Date.now() - 90 * 60_000) })
        .where(eq(incident.id, k.id)),
    );
    const late = await caseStatus(c, k.id);
    const info = slaInfo(late);
    expect(info.state).toBe("breached");
    expect(info.remainingMs!).toBeLessThan(0);
    // On hold or waiting on the customer doesn't stop the clock.
    must(await setCaseStatus(c, k.id, "on_hold"));
    expect(slaInfo(await caseStatus(c, k.id)).state).toBe("breached");
    // Resolving after the due time is recorded as missed, and stays that way.
    must(await resolveCase(c, k.id, { resolution: "Replaced igniter" }));
    expect(slaInfo(await caseStatus(c, k.id)).state).toBe("missed");
  });
});

describe.skipIf(!enabled)("Cases", () => {
  it("sets the SLA from the priority, and a priority change re-derives it from when the case was opened", async () => {
    const { admin: c } = await newBusiness();
    const k = await mkCase(c); // normal
    expect(k.slaDueAt).toEqual(slaDueAt(k.createdAt, "normal"));
    const hi = must(await updateCase(c, k.id, { priority: "high" })).case;
    expect(hi.slaDueAt).toEqual(slaDueAt(k.createdAt, "high"));
    const same = must(await updateCase(c, k.id, { title: "Renamed" })).case;
    expect(same.slaDueAt).toEqual(hi.slaDueAt); // other edits leave it alone
    expect(
      (await auditOf(c.tenantId, k.id)).some((a) => JSON.stringify(a.changes).includes("priority")),
    ).toBe(true);
  });

  it("validates input and links", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const { admin: c } = a;
    expect(await createCase(c, { title: " " })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createCase(c, { title: "x", priority: "extreme" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createCase(c, { title: "x", caseType: "complaint" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await createCase(c, {
        title: "x",
        customerAccountId: "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    // Another business's subject, queue and account aren't usable here.
    const otherSubject = must(await createSubject(b.admin, { name: "Billing" })).subject;
    const otherQueue = must(await createQueue(b.admin, { name: "Support" })).queue;
    const otherAcct = must(await createAccount(b.admin, { name: "Elsewhere" })).account;
    expect(await createCase(c, { title: "x", subjectId: otherSubject.id })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createCase(c, { title: "x", queueId: otherQueue.id })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createCase(c, { title: "x", customerAccountId: otherAcct.id })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const s = must(await createSubject(c, { name: "Heating" })).subject;
    const q = must(await createQueue(c, { name: "Dispatch" })).queue;
    expect(
      must(await createCase(c, { title: "ok", subjectId: s.id, queueId: q.id })).case,
    ).toMatchObject({ subjectId: s.id, queueId: q.id });
  });

  it("moves between In Progress, On Hold and Waiting on Customer, and resolves with a resolution", async () => {
    const { admin: c } = await newBusiness();
    const k = await mkCase(c);
    expect(must(await setCaseStatus(c, k.id, "on_hold")).case.status).toBe("on_hold");
    expect(must(await setCaseStatus(c, k.id, "waiting_on_customer")).case.status).toBe(
      "waiting_on_customer",
    );
    expect(must(await setCaseStatus(c, k.id, "in_progress")).case.status).toBe("in_progress");
    expect(await setCaseStatus(c, k.id, "resolved")).toMatchObject({ ok: false, code: "invalid" }); // use Resolve
    expect(await resolveCase(c, k.id, { resolution: "  " })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await resolveCase(c, k.id, { resolution: "Fixed", billableMinutes: -5 })).toMatchObject({
      ok: false,
      code: "invalid",
    });

    const r = must(
      await resolveCase(c, k.id, { resolution: "Replaced the igniter", billableMinutes: 75 }),
    ).case;
    expect(r).toMatchObject({
      status: "resolved",
      resolution: "Replaced the igniter",
      billableMinutes: 75,
    });
    expect(r.resolvedAt).toBeInstanceOf(Date);
    expect(slaInfo(r).state).toBe("met");
    expect(await updateCase(c, k.id, { title: "Changed" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await setCaseStatus(c, k.id, "on_hold")).toMatchObject({ ok: false, code: "read_only" });
    expect(await resolveCase(c, k.id, { resolution: "again" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await convertToWorkOrder(c, k.id)).toMatchObject({ ok: false, code: "read_only" });
  });

  it("cancels and reactivates; reactivating restarts the SLA clock", async () => {
    const { admin: c, tenantId } = await newBusiness();
    const k = await mkCase(c, { priority: "urgent" });
    await withTenant(tenantId, (tx) =>
      tx
        .update(incident)
        .set({ slaDueAt: new Date(Date.now() - 3_600_000) })
        .where(eq(incident.id, k.id)),
    );
    expect(await reactivateCase(c, k.id)).toMatchObject({ ok: false, code: "conflict" }); // already active
    const x = must(await cancelCase(c, k.id, "Customer fixed it themselves")).case;
    expect(x.status).toBe("cancelled");
    expect(slaInfo(x).state).toBe("stopped");
    expect(await cancelCase(c, k.id)).toMatchObject({ ok: false, code: "read_only" });
    const back = must(await reactivateCase(c, k.id)).case;
    expect(back).toMatchObject({ status: "in_progress", resolvedAt: null });
    expect(slaInfo(back).state).toBe("on_track");
    expect(back.slaDueAt!.getTime()).toBeGreaterThan(
      Date.now() + (SLA_HOURS.urgent - 1) * 3_600_000,
    );
    expect((await auditOf(tenantId, k.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining(["create", "cancel", "reactivate"]),
    );
  });

  it("can't be resolved or cancelled while it has open work orders", async () => {
    const { admin: c } = await newBusiness();
    const k = await mkCase(c);
    const wo = must(await convertToWorkOrder(c, k.id)).workOrder;
    const blocked = await resolveCase(c, k.id, { resolution: "Done" });
    expect(blocked).toMatchObject({ ok: false, code: "conflict" });
    expect((blocked as { message: string }).message).toContain(wo.woNumber);
    expect(await cancelCase(c, k.id)).toMatchObject({ ok: false, code: "conflict" });

    for (const s of ["scheduled", "in_progress", "completed"])
      must(await setWorkOrderStatus(c, wo.id, s));
    expect(must(await resolveCase(c, k.id, { resolution: "Done on site" })).case.status).toBe(
      "resolved",
    );

    const k2 = await mkCase(c);
    const wo2 = must(await convertToWorkOrder(c, k2.id)).workOrder;
    must(await setWorkOrderStatus(c, wo2.id, "cancelled"));
    expect(must(await cancelCase(c, k2.id)).case.status).toBe("cancelled");
  });

  it("lists by view, soonest SLA first, and searches by title or ticket number", async () => {
    const { admin: c } = await newBusiness();
    const low = await mkCase(c, { title: "Low one", priority: "low" });
    const urgent = await mkCase(c, { title: "Urgent one", priority: "urgent" });
    const done = await mkCase(c, { title: "Done one" });
    must(await resolveCase(c, done.id, { resolution: "ok" }));
    expect(must(await listCases(c, { view: "my_active" })).rows.map((r) => r.id)).toEqual([
      urgent.id,
      low.id,
    ]);
    expect(must(await listCases(c, { view: "all_active" })).total).toBe(2);
    expect(must(await listCases(c, { view: "resolved" })).rows.map((r) => r.id)).toEqual([done.id]);
    expect(
      must(await listCases(c, { view: "all_active", search: "urgent" })).rows.map((r) => r.id),
    ).toEqual([urgent.id]);
    expect(
      must(await listCases(c, { view: "all_active", search: low.ticketNumber })).rows.map(
        (r) => r.id,
      ),
    ).toEqual([low.id]);
  });

  it("notes and the timeline work on cases and work orders", async () => {
    const { admin: c } = await newBusiness();
    const k = await mkCase(c);
    const wo = must(await convertToWorkOrder(c, k.id)).workOrder;
    must(
      await addNote(c, { regardingType: "case", regardingId: k.id, body: "Customer called back" }),
    );
    must(
      await addNote(c, { regardingType: "work_order", regardingId: wo.id, body: "Gate code 4411" }),
    );
    expect(must(await timeline(c, "case", k.id)).items).toHaveLength(1);
    expect(must(await timeline(c, "work_order", wo.id)).items).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("Work orders", () => {
  it("creates, validates the time window, and edits while open", async () => {
    const { admin: c } = await newBusiness();
    expect(await createWorkOrder(c, { title: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createWorkOrder(c, {
        title: "x",
        timeWindowStart: "2030-05-01T10:00:00Z",
        timeWindowEnd: "2030-05-01T09:00:00Z",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(await createWorkOrder(c, { title: "x", estDurationMin: 0 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createWorkOrder(c, { title: "x", latitude: 123 })).toMatchObject({
      ok: false,
      code: "invalid",
    });

    const wo = must(
      await createWorkOrder(c, {
        title: "Annual service",
        workOrderType: "maintenance",
        timeWindowStart: "2030-05-01T09:00:00Z",
        timeWindowEnd: "2030-05-01T12:00:00Z",
        estDurationMin: 60,
      }),
    ).workOrder;
    expect(wo).toMatchObject({
      woNumber: "JOB-01001",
      status: "unscheduled",
      workOrderType: "maintenance",
      priority: "normal",
    });
    expect(
      await updateWorkOrder(c, wo.id, { timeWindowEnd: "2030-05-01T08:00:00Z" }),
    ).toMatchObject({ ok: false, code: "invalid" }); // before the stored start
    const u = must(
      await updateWorkOrder(c, wo.id, { instructions: "Bring filters", priority: "high" }),
    ).workOrder;
    expect(u).toMatchObject({ instructions: "Bring filters", priority: "high" });
    expect((await auditOf(c.tenantId, wo.id)).map((a) => a.action)).toEqual(
      expect.arrayContaining(["create", "update"]),
    );
  });

  it("follows the status flow and is read-only once completed", async () => {
    const { admin: c } = await newBusiness();
    const wo = must(await createWorkOrder(c, { title: "Job" })).workOrder;
    expect(await setWorkOrderStatus(c, wo.id, "completed")).toMatchObject({
      ok: false,
      code: "conflict",
    }); // can't skip steps
    expect(await setWorkOrderStatus(c, wo.id, "nonsense")).toMatchObject({
      ok: false,
      code: "invalid",
    });
    for (const s of ["scheduled", "in_progress", "completed"])
      expect(must(await setWorkOrderStatus(c, wo.id, s)).workOrder.status).toBe(s);
    expect(await updateWorkOrder(c, wo.id, { title: "Changed" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await setWorkOrderStatus(c, wo.id, "cancelled")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(must(await setWorkOrderStatus(c, wo.id, "posted")).workOrder.status).toBe("posted");
    expect(await setWorkOrderStatus(c, wo.id, "in_progress")).toMatchObject({
      ok: false,
      code: "conflict",
    }); // posted is final
    expect(must(await listWorkOrders(c, { view: "completed" })).rows.map((r) => r.id)).toEqual([
      wo.id,
    ]);
    expect(must(await listWorkOrders(c, { view: "all_open" })).total).toBe(0);
  });
});

describe.skipIf(!enabled)("Service permissions and isolation", () => {
  it("roles: sales can't see service records, service reps can, technicians read work orders only", async () => {
    const biz = await newBusiness();
    const k = await mkCase(biz.admin);
    const wo = must(await convertToWorkOrder(biz.admin, k.id)).workOrder;

    const sales = await addUser(biz, "Salesperson");
    expect(await createCase(sales, { title: "x" })).toMatchObject({ ok: false, code: "forbidden" });
    expect(await listCases(sales)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await getCase(sales, k.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await getWorkOrder(sales, wo.id)).toMatchObject({ ok: false, code: "not_found" });

    const csr = await addUser(biz, "Customer Service Rep");
    const mine = await mkCase(csr, { title: "Rep case" });
    expect(must(await convertToWorkOrder(csr, mine.id)).workOrder.status).toBe("unscheduled");
    expect(must(await updateCase(csr, k.id, { title: "Edited by rep" })).case.title).toBe(
      "Edited by rep",
    ); // organization-level write
    expect(must(await listCases(csr, { view: "all_active" })).total).toBe(2);
    expect(await createQueue(csr, { name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    }); // admins configure queues
    expect(await createSubject(csr, { name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(must(await listQueues(csr)).rows).toHaveLength(0);
    expect(must(await listSubjects(csr)).rows).toHaveLength(0);

    const tech = await addUser(biz, "Field Technician");
    expect(must(await getWorkOrder(tech, wo.id)).workOrder.id).toBe(wo.id);
    expect(await createWorkOrder(tech, { title: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await updateWorkOrder(tech, wo.id, { title: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await setWorkOrderStatus(tech, wo.id, "scheduled")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await getCase(tech, k.id)).toMatchObject({ ok: false, code: "not_found" });

    const viewer = await addUser(biz, "Read-only");
    expect(must(await getCase(viewer, k.id)).case.id).toBe(k.id);
    expect(await createCase(viewer, { title: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await resolveCase(viewer, k.id, { resolution: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("another business can't see or touch these records", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const k = await mkCase(a.admin);
    const wo = must(await convertToWorkOrder(a.admin, k.id)).workOrder;
    expect(await getCase(b.admin, k.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await updateCase(b.admin, k.id, { title: "Hacked" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await resolveCase(b.admin, k.id, { resolution: "x" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await convertToWorkOrder(b.admin, k.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await getWorkOrder(b.admin, wo.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await setWorkOrderStatus(b.admin, wo.id, "scheduled")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(must(await listCases(b.admin, { view: "all_active" })).total).toBe(0);
    expect(must(await listWorkOrders(b.admin)).total).toBe(0);
    // Numbering is per business: B's first case is also REQ-01001.
    expect((await mkCase(b.admin)).ticketNumber).toBe("REQ-01001");
  });
});
