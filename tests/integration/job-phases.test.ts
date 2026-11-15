import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { createResource } from "@/server/domain/resources";
import {
  addJobPhase,
  listJobPhases,
  removeJobPhase,
  setJobPhaseStatus,
  updateJobPhase,
} from "@/server/domain/job-phases";
import { createBooking, listWorkOrderBookings, setBookingStatus } from "@/server/domain/bookings";
import { createWorkOrder, getWorkOrder, setWorkOrderStatus } from "@/server/domain/work-orders";
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

async function setup() {
  const biz = await newBusiness();
  const dispatcher = await addUser(biz, "Customer Service Rep");
  const tech = await addUser(biz, "Field Technician");
  const resource = must(
    await createResource(biz.admin, { name: "Tech A", userId: tech.userId }),
  ).resource;
  const wo = must(await createWorkOrder(dispatcher, { title: "Replace the furnace" })).workOrder;
  return { biz, admin: biz.admin, dispatcher, tech, resource, wo };
}

const statusOf = async (c: Ctx, id: string) => must(await getWorkOrder(c, id)).workOrder.status;

describe.skipIf(!enabled)("Job phases", () => {
  it("numbers phases within the job and keeps each one's own details", async () => {
    const { dispatcher, wo } = await setup();
    const a = must(
      await addJobPhase(dispatcher, wo.id, {
        title: "Remove the old furnace",
        instructions: "Shut off gas first",
        estDurationMin: 120,
      }),
    ).phase;
    const b = must(
      await addJobPhase(dispatcher, wo.id, { title: "Install the new furnace" }),
    ).phase;
    expect([a.phaseNumber, b.phaseNumber]).toEqual([1, 2]);
    expect(a).toMatchObject({ status: "unscheduled", estDurationMin: 120 });
    const list = must(await listJobPhases(dispatcher, wo.id)).phases;
    expect(list.map((p) => p.title)).toEqual(["Remove the old furnace", "Install the new furnace"]);
  });

  it("numbering is per job, so another job starts again at 1", async () => {
    const { dispatcher, wo } = await setup();
    const other = must(await createWorkOrder(dispatcher, { title: "Another job" })).workOrder;
    must(await addJobPhase(dispatcher, wo.id, { title: "One" }));
    const first = must(await addJobPhase(dispatcher, other.id, { title: "Elsewhere" })).phase;
    expect(first.phaseNumber).toBe(1);
  });

  it("needs a title, and an estimate that makes sense", async () => {
    const { dispatcher, wo } = await setup();
    expect((await addJobPhase(dispatcher, wo.id, { title: "  " })).ok).toBe(false);
    expect((await addJobPhase(dispatcher, wo.id, { title: "x", estDurationMin: 0 })).ok).toBe(
      false,
    );
  });

  it("edits a phase until it is finished, then locks it", async () => {
    const { dispatcher, wo } = await setup();
    const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
    const edited = must(await updateJobPhase(dispatcher, ph.id, { title: "Demolition" })).phase;
    expect(edited.title).toBe("Demolition");
    must(await setJobPhaseStatus(dispatcher, ph.id, "in_progress"));
    must(await setJobPhaseStatus(dispatcher, ph.id, "completed"));
    const locked = await updateJobPhase(dispatcher, ph.id, { title: "Too late" });
    expect(locked).toMatchObject({ ok: false, code: "read_only" });
    const done = must(await listJobPhases(dispatcher, wo.id)).phases[0]!;
    expect(done.completedAt).toBeInstanceOf(Date);
  });

  it("follows the phase status flow and refuses a skipped step", async () => {
    const { dispatcher, wo } = await setup();
    const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
    expect(await setJobPhaseStatus(dispatcher, ph.id, "completed")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect((await setJobPhaseStatus(dispatcher, ph.id, "posted")).ok).toBe(false);
  });

  it("removes only a phase that hasn't started", async () => {
    const { dispatcher, wo } = await setup();
    const fresh = must(await addJobPhase(dispatcher, wo.id, { title: "Spare" })).phase;
    const going = must(await addJobPhase(dispatcher, wo.id, { title: "Going" })).phase;
    must(await setJobPhaseStatus(dispatcher, going.id, "in_progress"));
    expect(await removeJobPhase(dispatcher, going.id)).toMatchObject({
      ok: false,
      code: "conflict",
    });
    must(await removeJobPhase(dispatcher, fresh.id));
    expect(must(await listJobPhases(dispatcher, wo.id)).phases.map((p) => p.title)).toEqual([
      "Going",
    ]);
  });

  it("is audited against the main job", async () => {
    const { biz, dispatcher, wo } = await setup();
    const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
    must(await setJobPhaseStatus(dispatcher, ph.id, "in_progress"));
    const actions = (await auditOf(biz.tenantId, wo.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["add_phase", "phase_status"]));
  });

  it("is only for people who can edit the job, and stays inside one business", async () => {
    const { dispatcher, tech, wo } = await setup();
    const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
    expect((await addJobPhase(tech, wo.id, { title: "Sneaky" })).ok).toBe(false);
    expect((await setJobPhaseStatus(tech, ph.id, "in_progress")).ok).toBe(false);
    const stranger = (await setup()).dispatcher;
    expect((await listJobPhases(stranger, wo.id)).ok).toBe(false);
    expect((await setJobPhaseStatus(stranger, ph.id, "in_progress")).ok).toBe(false);
  });

  it("blocks completing the main job while a phase is open, and allows it once they are done", async () => {
    const { dispatcher, wo } = await setup();
    const one = must(await addJobPhase(dispatcher, wo.id, { title: "One" })).phase;
    const two = must(await addJobPhase(dispatcher, wo.id, { title: "Two" })).phase;
    must(await setWorkOrderStatus(dispatcher, wo.id, "scheduled"));
    must(await setWorkOrderStatus(dispatcher, wo.id, "in_progress"));
    const blocked = await setWorkOrderStatus(dispatcher, wo.id, "completed");
    expect(blocked).toMatchObject({ ok: false, code: "conflict" });
    if (!blocked.ok) expect(blocked.message).toContain("2 open phases");

    must(await setJobPhaseStatus(dispatcher, one.id, "in_progress"));
    must(await setJobPhaseStatus(dispatcher, one.id, "completed"));
    must(await setJobPhaseStatus(dispatcher, two.id, "cancelled"));
    must(await setWorkOrderStatus(dispatcher, wo.id, "completed"));
    expect(await statusOf(dispatcher, wo.id)).toBe("completed");
  });

  it("cancelling the main job cancels the phases still open and keeps finished ones", async () => {
    const { biz, dispatcher, wo } = await setup();
    const done = must(await addJobPhase(dispatcher, wo.id, { title: "Done" })).phase;
    must(await addJobPhase(dispatcher, wo.id, { title: "Open" }));
    must(await setJobPhaseStatus(dispatcher, done.id, "in_progress"));
    must(await setJobPhaseStatus(dispatcher, done.id, "completed"));
    must(await setWorkOrderStatus(dispatcher, wo.id, "cancelled"));
    const phases = must(await listJobPhases(dispatcher, wo.id)).phases;
    expect(phases.map((p) => p.status)).toEqual(["completed", "cancelled"]);
    const status = (await auditOf(biz.tenantId, wo.id)).find((a) => a.action === "status");
    expect(JSON.stringify(status?.changes)).toContain("cancelledPhases");
  });

  it("refuses new phases once the main job is finished or cancelled", async () => {
    const { dispatcher, wo } = await setup();
    must(await setWorkOrderStatus(dispatcher, wo.id, "cancelled"));
    expect(await addJobPhase(dispatcher, wo.id, { title: "Late" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
  });

  it("a finished visit doesn't complete the job while a phase is still open", async () => {
    const { dispatcher, tech, resource, wo } = await setup();
    const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Second trip" })).phase;
    const booking = must(
      await createBooking(dispatcher, {
        workOrderId: wo.id,
        resourceId: resource.id,
        startAt: "2030-05-01T09:00:00Z",
        endAt: "2030-05-01T10:00:00Z",
      }),
    ).booking;
    expect(await statusOf(dispatcher, wo.id)).toBe("scheduled");
    must(await setBookingStatus(tech, booking.id, "in_progress"));
    expect(await statusOf(dispatcher, wo.id)).toBe("in_progress");
    must(await setBookingStatus(tech, booking.id, "completed"));
    expect(await statusOf(dispatcher, wo.id)).toBe("in_progress"); // phase still open

    must(await setJobPhaseStatus(dispatcher, ph.id, "in_progress"));
    must(await setJobPhaseStatus(dispatcher, ph.id, "completed"));
    must(await setWorkOrderStatus(dispatcher, wo.id, "completed"));
    expect(await statusOf(dispatcher, wo.id)).toBe("completed");
  });

  describe("visits for a phase", () => {
    const visit = (
      c: Ctx,
      workOrderId: string,
      resourceId: string,
      phaseId: string | null,
      day = 1,
    ) =>
      createBooking(c, {
        workOrderId,
        phaseId,
        resourceId,
        startAt: `2030-05-0${day}T09:00:00Z`,
        endAt: `2030-05-0${day}T10:00:00Z`,
      });

    async function twoTechs() {
      const base = await setup();
      const tech2 = await addUser(base.biz, "Field Technician");
      const resource2 = must(
        await createResource(base.biz.admin, { name: "Tech B", userId: tech2.userId }),
      ).resource;
      return { ...base, tech2, resource2 };
    }

    it("books a phase, which schedules the phase and the job", async () => {
      const { dispatcher, resource, wo } = await setup();
      const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
      const b = must(await visit(dispatcher, wo.id, resource.id, ph.id)).booking;
      expect(b.phaseId).toBe(ph.id);
      expect(
        (await listJobPhases(dispatcher, wo.id)).ok && (await statusOf(dispatcher, wo.id)),
      ).toBe("scheduled");
      const phases = must(await listJobPhases(dispatcher, wo.id)).phases;
      expect(phases[0]!.status).toBe("scheduled");
    });

    it("lets two technicians work two phases of one job at the same time", async () => {
      const { dispatcher, tech, tech2, resource, resource2, wo } = await twoTechs();
      const one = must(await addJobPhase(dispatcher, wo.id, { title: "Remove" })).phase;
      const two = must(await addJobPhase(dispatcher, wo.id, { title: "Install" })).phase;
      const a = must(await visit(dispatcher, wo.id, resource.id, one.id)).booking;
      const b = must(await visit(dispatcher, wo.id, resource2.id, two.id)).booking;

      // Tech A starts and finishes phase 1; the job is under way, and not finished.
      must(await setBookingStatus(tech, a.id, "in_progress"));
      expect(await statusOf(dispatcher, wo.id)).toBe("in_progress");
      must(await setBookingStatus(tech, a.id, "completed"));
      let phases = must(await listJobPhases(dispatcher, wo.id)).phases;
      expect(phases.map((p) => p.status)).toEqual(["completed", "scheduled"]);
      expect(await statusOf(dispatcher, wo.id)).toBe("in_progress");

      // Tech B finishes phase 2: now nothing is open, so the job completes.
      must(await setBookingStatus(tech2, b.id, "in_progress"));
      must(await setBookingStatus(tech2, b.id, "completed"));
      phases = must(await listJobPhases(dispatcher, wo.id)).phases;
      expect(phases.map((p) => p.status)).toEqual(["completed", "completed"]);
      expect(await statusOf(dispatcher, wo.id)).toBe("completed");
    });

    it("allows one live visit for each phase, and one for the whole job", async () => {
      const { dispatcher, resource, resource2, wo } = await twoTechs();
      const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
      must(await visit(dispatcher, wo.id, resource.id, ph.id));
      expect(await visit(dispatcher, wo.id, resource2.id, ph.id)).toMatchObject({
        ok: false,
        code: "conflict",
      });
      // The whole job is a separate booking from the phase.
      must(await visit(dispatcher, wo.id, resource2.id, null, 2));
      expect(await visit(dispatcher, wo.id, resource.id, null, 3)).toMatchObject({
        ok: false,
        code: "conflict",
      });
    });

    it("refuses a phase of another job, and a phase that is already done", async () => {
      const { dispatcher, resource, wo } = await setup();
      const other = must(await createWorkOrder(dispatcher, { title: "Other job" })).workOrder;
      const foreign = must(await addJobPhase(dispatcher, other.id, { title: "Elsewhere" })).phase;
      expect(await visit(dispatcher, wo.id, resource.id, foreign.id)).toMatchObject({
        ok: false,
        code: "invalid",
      });
      const done = must(await addJobPhase(dispatcher, wo.id, { title: "Done" })).phase;
      must(await setJobPhaseStatus(dispatcher, done.id, "in_progress"));
      must(await setJobPhaseStatus(dispatcher, done.id, "completed"));
      expect(await visit(dispatcher, wo.id, resource.id, done.id)).toMatchObject({
        ok: false,
        code: "conflict",
      });
    });

    it("cancelling the visit sends the phase, and the job, back to unscheduled", async () => {
      const { dispatcher, resource, wo } = await setup();
      const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Demo" })).phase;
      const b = must(await visit(dispatcher, wo.id, resource.id, ph.id)).booking;
      must(await setBookingStatus(dispatcher, b.id, "cancelled"));
      expect(must(await listJobPhases(dispatcher, wo.id)).phases[0]!.status).toBe("unscheduled");
      expect(await statusOf(dispatcher, wo.id)).toBe("unscheduled");
    });

    it("cancelling a phase cancels its booked visit, but not one that is under way", async () => {
      const { dispatcher, resource, resource2, wo } = await twoTechs();
      const one = must(await addJobPhase(dispatcher, wo.id, { title: "One" })).phase;
      const two = must(await addJobPhase(dispatcher, wo.id, { title: "Two" })).phase;
      const a = must(await visit(dispatcher, wo.id, resource.id, one.id)).booking;
      const b = must(await visit(dispatcher, wo.id, resource2.id, two.id)).booking;
      must(await setJobPhaseStatus(dispatcher, one.id, "cancelled"));
      const bookings = must(await listWorkOrderBookings(dispatcher, wo.id)).rows;
      expect(bookings.find((x) => x.id === a.id)?.status).toBe("cancelled");
      expect(bookings.find((x) => x.id === b.id)?.status).toBe("scheduled");
      expect(await statusOf(dispatcher, wo.id)).toBe("scheduled");

      // Phase 2's visit is under way, so it can't be cancelled out from under the technician.
      must(await setBookingStatus(dispatcher, b.id, "in_progress"));
      expect(await setJobPhaseStatus(dispatcher, two.id, "cancelled")).toMatchObject({
        ok: false,
        code: "conflict",
      });
    });

    it("shows which phase each visit is for", async () => {
      const { dispatcher, resource, wo } = await setup();
      const ph = must(await addJobPhase(dispatcher, wo.id, { title: "Rough-in" })).phase;
      must(await visit(dispatcher, wo.id, resource.id, ph.id));
      const rows = must(await listWorkOrderBookings(dispatcher, wo.id)).rows;
      expect(rows[0]).toMatchObject({ phaseNumber: 1, phaseTitle: "Rough-in" });
    });
  });
});
