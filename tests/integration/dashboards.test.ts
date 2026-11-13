import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { incident, opportunity, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { addActivity } from "@/server/domain/activities";
import { createBooking } from "@/server/domain/bookings";
import { createCase } from "@/server/domain/cases";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { salesDashboard, serviceDashboard } from "@/server/domain/dashboards";
import { createLead } from "@/server/domain/leads";
import { createOpportunity } from "@/server/domain/opportunities";
import { createResource } from "@/server/domain/resources";
import { createWorkOrder } from "@/server/domain/work-orders";
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

const NOW = new Date("2030-05-15T15:00:00Z"); // a Wednesday in Q2 2030
const OPTS = { now: NOW, tz: "UTC" };

async function opp(c: Ctx, name: string, cents: number, set: Record<string, unknown> = {}) {
  const o = must(await createOpportunity(c, { name, estRevenueCents: cents })).opportunity;
  if (Object.keys(set).length) {
    await withTenant(c.tenantId, (tx) =>
      tx.update(opportunity).set(set).where(eq(opportunity.id, o.id)),
    );
  }
  return o;
}
const lead = (c: Ctx, source: string | null, status?: string) =>
  createLead(c, {
    lastName: `L${rand()}`,
    companyName: `Co ${rand()}`,
    email: `l-${rand()}@x.test`,
    phone: `412-555-${Math.floor(1000 + Math.random() * 8999)}`,
    ...(source ? { leadSource: source } : {}),
    ...(status ? { status } : {}),
  }).then(must);

describe.skipIf(!enabled)("Sales dashboard", () => {
  it("totals the open pipeline by stage, with every stage listed", async () => {
    const { admin: c } = await newBusiness();
    await opp(c, "A", 100_00);
    await opp(c, "B", 250_00);
    await opp(c, "C", 1_000_00, { stage: "propose" });
    await opp(c, "Closed", 9_999_00, { status: "lost" }); // not open: left out
    const d = must(await salesDashboard(c, OPTS));
    expect(d.pipeline).toEqual([
      { key: "qualify", label: "Qualify", count: 2, cents: 350_00 },
      { key: "develop", label: "Develop", count: 0, cents: 0 },
      { key: "propose", label: "Propose", count: 1, cents: 1_000_00 },
      { key: "close", label: "Close", count: 0, cents: 0 },
    ]);
  });

  it("counts revenue won this quarter only, by the close date", async () => {
    const { admin: c } = await newBusiness();
    const won = (date: string | null, cents: number, status = "won") => ({
      status,
      actualRevenueCents: cents,
      actualCloseDate: date,
    });
    await opp(c, "In range start", 1, won("2030-04-01", 500_00));
    await opp(c, "In range end", 1, won("2030-06-30", 700_00));
    await opp(c, "Before", 1, won("2030-03-31", 9_000_00));
    await opp(c, "After", 1, won("2030-07-01", 9_000_00));
    await opp(c, "Lost this quarter", 1, won("2030-05-01", 9_000_00, "lost"));
    const d = must(await salesDashboard(c, OPTS));
    expect(d).toMatchObject({ quarter: "Q2 2030", wonCents: 1_200_00, wonCount: 2 });
  });

  it("groups open leads by source, most common first, and leaves out closed ones", async () => {
    const { admin: c } = await newBusiness();
    await lead(c, "web");
    await lead(c, "web");
    await lead(c, "referral");
    await lead(c, null);
    const closed = await lead(c, "web");
    await withTenant(c.tenantId, async (tx) => {
      const { lead: t } = await import("@/db/schema");
      await tx.update(t).set({ status: "disqualified" }).where(eq(t.id, closed.lead.id));
    });
    const d = must(await salesDashboard(c, OPTS));
    expect(d.leadsBySource).toEqual([
      { key: "web", label: "Web", count: 2 },
      { key: "unknown", label: "No source", count: 1 }, // ties are in name order, and "no source" sorts first
      { key: "referral", label: "Referral", count: 1 },
    ]);
  });

  it("lists my open activities soonest first, with a link to what they're about", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const wo = must(await createWorkOrder(c, { title: "Job" })).workOrder;
    must(
      await addActivity(c, {
        activityType: "task",
        subject: "Later",
        dueAt: "2030-05-20T09:00:00Z",
      }),
    );
    must(
      await addActivity(c, {
        activityType: "task",
        subject: "Sooner",
        dueAt: "2030-05-16T09:00:00Z",
        regardingType: "work_order",
        regardingId: wo.id,
      }),
    );
    must(await addActivity(c, { activityType: "task", subject: "Undated" }));
    const done = must(
      await addActivity(c, {
        activityType: "task",
        subject: "Done",
        dueAt: "2030-05-10T09:00:00Z",
      }),
    );
    const { completeActivity } = await import("@/server/domain/activities");
    must(await completeActivity(c, done.activity.id));
    const rep = await addUser(biz, "Salesperson");
    must(
      await addActivity(rep, {
        activityType: "task",
        subject: "Someone else's",
        dueAt: "2030-05-16T10:00:00Z",
      }),
    );

    const d = must(await salesDashboard(c, OPTS));
    expect(d.myActivities!.map((a) => a.subject)).toEqual(["Sooner", "Later", "Undated"]);
    expect(d.myActivities![0]).toMatchObject({ type: "Task", href: `/app/work-orders/${wo.id}` });
  });

  it("a user-level role sees only their own records, and a role without access gets nothing", async () => {
    const biz = await newBusiness();
    const rep = await addUser(biz, "Salesperson");
    await opp(biz.admin, "Boss's deal", 5_000_00);
    await opp(rep, "My deal", 100_00);
    const d = must(await salesDashboard(rep, OPTS));
    expect(d.pipeline!.find((s) => s.key === "qualify")).toMatchObject({ count: 1, cents: 100_00 });

    const tech = await addUser(biz, "Field Technician"); // no sales privileges
    const t = must(await salesDashboard(tech, OPTS));
    expect(t).toMatchObject({ pipeline: null, wonCents: null, leadsBySource: null });
  });

  it("never mixes in another business's numbers", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    await opp(a.admin, "A only", 777_00);
    expect(must(await salesDashboard(b.admin, OPTS)).pipeline!.every((s) => s.count === 0)).toBe(
      true,
    );
  });
});

describe.skipIf(!enabled)("Service dashboard", () => {
  it("counts active cases by priority and lists the ones past their SLA, most overdue first", async () => {
    const { admin: c } = await newBusiness();
    const mk = async (title: string, priority: string, set: Record<string, unknown> = {}) => {
      const k = must(await createCase(c, { title, priority })).case;
      if (Object.keys(set).length) {
        await withTenant(c.tenantId, (tx) =>
          tx.update(incident).set(set).where(eq(incident.id, k.id)),
        );
      }
      return k;
    };
    await mk("Urgent late", "urgent", { slaDueAt: new Date(NOW.getTime() - 3 * 3_600_000) });
    await mk("Normal late", "normal", { slaDueAt: new Date(NOW.getTime() - 3_600_000) });
    await mk("Normal fine", "normal", { slaDueAt: new Date(NOW.getTime() + 3_600_000) });
    await mk("High on hold, late", "high", {
      status: "on_hold",
      slaDueAt: new Date(NOW.getTime() - 60_000),
    });
    await mk("Resolved late", "low", {
      status: "resolved",
      slaDueAt: new Date(NOW.getTime() - 9 * 3_600_000),
    });
    await mk("Cancelled", "low", {
      status: "cancelled",
      slaDueAt: new Date(NOW.getTime() - 9 * 3_600_000),
    });

    const d = must(await serviceDashboard(c, OPTS));
    expect(d.casesByPriority!.map((s) => [s.key, s.count])).toEqual([
      ["urgent", 1],
      ["high", 1],
      ["normal", 2],
      ["low", 0],
    ]);
    expect(d.breachCount).toBe(3);
    expect(d.breaches!.map((b) => b.title)).toEqual([
      "Urgent late",
      "Normal late",
      "High on hold, late",
    ]);
    expect(d.breaches![0]).toMatchObject({ priority: "urgent" });
  });

  it("counts today's bookings by resource in the business's zone, not cancelled ones", async () => {
    const { admin: c } = await newBusiness();
    const r1 = must(await createResource(c, { name: "Alpha" })).resource;
    const r2 = must(await createResource(c, { name: "Bravo" })).resource;
    const book = async (r: { id: string }, start: string, end: string) =>
      must(
        await createBooking(c, {
          workOrderId: must(await createWorkOrder(c, { title: "J" })).workOrder.id,
          resourceId: r.id,
          startAt: start,
          endAt: end,
        }),
      ).booking;
    await book(r1, "2030-05-15T09:00:00Z", "2030-05-15T10:00:00Z");
    await book(r1, "2030-05-15T13:00:00Z", "2030-05-15T14:00:00Z");
    await book(r2, "2030-05-14T23:00:00Z", "2030-05-15T01:00:00Z"); // runs into today
    await book(r2, "2030-05-16T00:00:00Z", "2030-05-16T01:00:00Z"); // tomorrow: starts exactly at the end
    await book(r2, "2030-05-14T22:00:00Z", "2030-05-15T00:00:00Z"); // yesterday: ends exactly at the start
    const gone = await book(r2, "2030-05-15T11:00:00Z", "2030-05-15T12:00:00Z");
    const { setBookingStatus } = await import("@/server/domain/bookings");
    must(await setBookingStatus(c, gone.id, "cancelled"));

    const d = must(await serviceDashboard(c, OPTS));
    expect(d.bookingsToday).toEqual([
      { key: "Alpha", label: "Alpha", count: 2 },
      { key: "Bravo", label: "Bravo", count: 1 },
    ]);
    expect(d.bookingsTotal).toBe(3);

    // In New York "today" is 4:00 UTC to 4:00 UTC the next day, which moves what counts.
    const ny = must(await serviceDashboard(c, { now: NOW, tz: "America/New_York" }));
    expect(ny.bookingsTotal).toBe(3); // 13:00-14:00 and 09:00-10:00 Alpha + the 23:00-01:00 Bravo
  });

  it("a technician sees only their own bookings; a salesperson (no service access) gets nothing", async () => {
    const biz = await newBusiness();
    const tech = await addUser(biz, "Field Technician");
    const mine = must(
      await createResource(biz.admin, { name: "Mine", userId: tech.userId }),
    ).resource;
    const other = must(await createResource(biz.admin, { name: "Other" })).resource;
    for (const r of [mine, other]) {
      const wo = must(await createWorkOrder(biz.admin, { title: "J" })).workOrder;
      must(
        await createBooking(biz.admin, {
          workOrderId: wo.id,
          resourceId: r.id,
          startAt: "2030-05-15T09:00:00Z",
          endAt: "2030-05-15T10:00:00Z",
        }),
      );
    }
    expect(must(await serviceDashboard(tech, OPTS)).bookingsToday).toEqual([
      { key: "Mine", label: "Mine", count: 1 },
    ]);
    const rep = await addUser(biz, "Salesperson");
    expect(must(await serviceDashboard(rep, OPTS))).toMatchObject({
      casesByPriority: null,
      breaches: null,
      bookingsToday: null,
    });
  });
});
