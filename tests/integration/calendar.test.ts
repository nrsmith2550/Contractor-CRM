import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { securityRole } from "@/db/schema";
import { eq } from "drizzle-orm";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { addActivity } from "@/server/domain/activities";
import { createBooking } from "@/server/domain/bookings";
import { listCalendarEvents } from "@/server/domain/calendar";
import { buildCtx, type Ctx } from "@/server/domain/context";
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

const RANGE = { from: new Date("2030-05-01T00:00:00Z"), to: new Date("2030-05-08T00:00:00Z") };
const appt = (
  c: Ctx,
  subject: string,
  start: string,
  end: string | null,
  extra: Record<string, unknown> = {},
) =>
  addActivity(c, {
    activityType: "appointment",
    subject,
    scheduledStart: start,
    ...(end ? { scheduledEnd: end } : {}),
    ...extra,
  });
const task = (c: Ctx, subject: string, due: string) =>
  addActivity(c, { activityType: "task", subject, dueAt: due });
const titles = (r: { events: { title: string }[] }) => r.events.map((e) => e.title);

describe.skipIf(!enabled)("Calendar events", () => {
  it("collects a user's own appointments, due tasks and bookings in the range, in time order", async () => {
    const biz = await newBusiness();
    const tech = await addUser(biz, "Field Technician");
    const res = must(
      await createResource(biz.admin, { name: "Tess", userId: tech.userId }),
    ).resource;
    const wo = must(await createWorkOrder(biz.admin, { title: "Fix furnace" })).workOrder;
    must(
      await createBooking(biz.admin, {
        workOrderId: wo.id,
        resourceId: res.id,
        startAt: "2030-05-02T09:00:00Z",
        endAt: "2030-05-02T11:00:00Z",
      }),
    );

    must(await appt(tech, "Morning briefing", "2030-05-02T08:00:00Z", "2030-05-02T08:30:00Z"));
    must(await task(tech, "Send the report", "2030-05-02T15:00:00Z"));
    must(await appt(tech, "Next month", "2030-06-02T08:00:00Z", "2030-06-02T09:00:00Z")); // out of range
    must(await task(tech, "Far future", "2031-01-01T00:00:00Z")); // out of range

    const r = must(await listCalendarEvents(tech, RANGE));
    expect(titles(r)).toEqual([
      "Morning briefing",
      `${wo.woNumber} Fix furnace`,
      "Send the report",
    ]);
    expect(r.events.map((e) => e.kind)).toEqual(["appointment", "booking", "task"]);
    const booking = r.events[1]!;
    expect(booking).toMatchObject({
      href: `/app/work-orders/${wo.id}`,
      detail: "Tess",
      status: "scheduled",
      ownerId: tech.userId,
    });
    expect(r.events[2]!.end.getTime() - r.events[2]!.start.getTime()).toBe(30 * 60_000); // a task is drawn as a 30-minute marker
    expect(r.canSeeOthers).toBe(false);
  });

  it("includes events that straddle the edges of the range, and defaults a missing end to an hour", async () => {
    const { admin: c } = await newBusiness();
    must(await appt(c, "Starts before", "2030-04-30T22:00:00Z", "2030-05-01T02:00:00Z"));
    must(await appt(c, "Ends after", "2030-05-07T22:00:00Z", "2030-05-08T02:00:00Z"));
    must(
      await appt(c, "Ends exactly at the start", "2030-04-30T22:00:00Z", "2030-05-01T00:00:00Z"),
    ); // the range is half-open
    must(
      await appt(c, "Starts exactly at the end", "2030-05-08T00:00:00Z", "2030-05-08T01:00:00Z"),
    );
    must(await appt(c, "No end", "2030-05-03T10:00:00Z", null));
    const r = must(await listCalendarEvents(c, RANGE));
    expect(titles(r)).toEqual(["Starts before", "No end", "Ends after"]);
    const noEnd = r.events.find((e) => e.title === "No end")!;
    expect(noEnd.end.getTime() - noEnd.start.getTime()).toBe(3_600_000);
  });

  it("leaves out cancelled bookings and anything that isn't an appointment or task", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const res = must(await createResource(biz.admin, { name: "Crew", userId: c.userId })).resource;
    const wo = must(await createWorkOrder(c, { title: "Job" })).workOrder;
    const booking = must(
      await createBooking(c, {
        workOrderId: wo.id,
        resourceId: res.id,
        startAt: "2030-05-02T09:00:00Z",
        endAt: "2030-05-02T10:00:00Z",
      }),
    ).booking;
    must(
      await addActivity(c, {
        activityType: "phone_call",
        subject: "A call",
        scheduledStart: "2030-05-02T09:00:00Z",
      }),
    );
    must(await addActivity(c, { activityType: "appointment", subject: "Undated appointment" })); // no time: nowhere to draw it
    expect(titles(must(await listCalendarEvents(c, RANGE)))).toEqual([`${wo.woNumber} Job`]);
    const { setBookingStatus } = await import("@/server/domain/bookings");
    must(await setBookingStatus(c, booking.id, "cancelled"));
    expect(must(await listCalendarEvents(c, RANGE)).events).toHaveLength(0);
  });

  it("links an appointment to the record it is about", async () => {
    const { admin: c } = await newBusiness();
    const wo = must(await createWorkOrder(c, { title: "Job" })).workOrder;
    must(
      await appt(c, "Site walk", "2030-05-02T09:00:00Z", "2030-05-02T10:00:00Z", {
        regardingType: "work_order",
        regardingId: wo.id,
      }),
    );
    must(await appt(c, "Plain", "2030-05-03T09:00:00Z", "2030-05-03T10:00:00Z"));
    const r = must(await listCalendarEvents(c, RANGE));
    expect(r.events.find((e) => e.title === "Site walk")!.href).toBe(`/app/work-orders/${wo.id}`);
    expect(r.events.find((e) => e.title === "Plain")!.href).toBeNull();
  });

  it("someone with organization-wide access can see everyone, or one person", async () => {
    const biz = await newBusiness();
    const mgr = await addUser(biz, "Sales Manager");
    const rep = await addUser(biz, "Salesperson");
    must(await appt(rep, "Rep's meeting", "2030-05-02T09:00:00Z", "2030-05-02T10:00:00Z"));
    must(await appt(mgr, "Manager's meeting", "2030-05-02T11:00:00Z", "2030-05-02T12:00:00Z"));

    const mine = must(await listCalendarEvents(mgr, RANGE));
    expect(titles(mine)).toEqual(["Manager's meeting"]);
    expect(mine.canSeeOthers).toBe(true);
    expect(titles(must(await listCalendarEvents(mgr, { ...RANGE, user: "all" })))).toEqual([
      "Rep's meeting",
      "Manager's meeting",
    ]);
    const theirs = must(await listCalendarEvents(mgr, { ...RANGE, user: rep.userId }));
    expect(titles(theirs)).toEqual(["Rep's meeting"]);
    expect(theirs.events[0]!.ownerName).toBe("Salesperson");
    expect(titles(must(await listCalendarEvents(mgr, { ...RANGE, user: mgr.userId })))).toEqual([
      "Manager's meeting",
    ]);
  });

  it("a user-level role sees only their own calendar", async () => {
    const biz = await newBusiness();
    const rep = await addUser(biz, "Salesperson");
    const other = await addUser(biz, "Salesperson");
    must(await appt(rep, "Mine", "2030-05-02T09:00:00Z", "2030-05-02T10:00:00Z"));
    must(await appt(other, "Theirs", "2030-05-02T09:00:00Z", "2030-05-02T10:00:00Z"));
    expect(titles(must(await listCalendarEvents(rep, RANGE)))).toEqual(["Mine"]);
    expect(titles(must(await listCalendarEvents(rep, { ...RANGE, user: rep.userId })))).toEqual([
      "Mine",
    ]); // asking for yourself is fine
    expect(await listCalendarEvents(rep, { ...RANGE, user: "all" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await listCalendarEvents(rep, { ...RANGE, user: other.userId })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    // Even if they could ask, the query itself is scoped: "mine" never includes the other's.
    expect(must(await listCalendarEvents(other, RANGE)).events.map((e) => e.ownerId)).toEqual([
      other.userId,
    ]);
  });

  it("a technician sees their own bookings but not a colleague's", async () => {
    const biz = await newBusiness();
    const t1 = await addUser(biz, "Field Technician");
    const t2 = await addUser(biz, "Field Technician");
    const r1 = must(await createResource(biz.admin, { name: "T1", userId: t1.userId })).resource;
    const r2 = must(await createResource(biz.admin, { name: "T2", userId: t2.userId })).resource;
    const a = must(await createWorkOrder(biz.admin, { title: "For T1" })).workOrder;
    const b = must(await createWorkOrder(biz.admin, { title: "For T2" })).workOrder;
    must(
      await createBooking(biz.admin, {
        workOrderId: a.id,
        resourceId: r1.id,
        startAt: "2030-05-02T09:00:00Z",
        endAt: "2030-05-02T10:00:00Z",
      }),
    );
    must(
      await createBooking(biz.admin, {
        workOrderId: b.id,
        resourceId: r2.id,
        startAt: "2030-05-02T09:00:00Z",
        endAt: "2030-05-02T10:00:00Z",
      }),
    );
    expect(titles(must(await listCalendarEvents(t1, RANGE)))).toEqual([`${a.woNumber} For T1`]);
    expect(await listCalendarEvents(t1, { ...RANGE, user: t2.userId })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    // The administrator can look at either, or both.
    expect(
      titles(must(await listCalendarEvents(biz.admin, { ...RANGE, user: t2.userId }))),
    ).toEqual([`${b.woNumber} For T2`]);
    expect(
      must(await listCalendarEvents(biz.admin, { ...RANGE, user: "all" })).events,
    ).toHaveLength(2);
  });

  it("roles without booking access still get their activities, and a read-only user sees others but owns nothing", async () => {
    const biz = await newBusiness();
    const rep = await addUser(biz, "Salesperson"); // no booking privileges at all
    must(await appt(rep, "Rep meeting", "2030-05-02T09:00:00Z", "2030-05-02T10:00:00Z"));
    expect(titles(must(await listCalendarEvents(rep, RANGE)))).toEqual(["Rep meeting"]);

    const viewer = await addUser(biz, "Read-only");
    expect(must(await listCalendarEvents(viewer, RANGE)).events).toHaveLength(0); // owns nothing
    expect(titles(must(await listCalendarEvents(viewer, { ...RANGE, user: "all" })))).toEqual([
      "Rep meeting",
    ]);
  });

  it("rejects a bad filter, and another business sees nothing", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    must(await appt(a.admin, "A's meeting", "2030-05-02T09:00:00Z", "2030-05-02T10:00:00Z"));
    expect(await listCalendarEvents(a.admin, { ...RANGE, user: "everybody" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await listCalendarEvents(a.admin, { ...RANGE, user: "not-a-uuid" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(must(await listCalendarEvents(b.admin, { ...RANGE, user: "all" })).events).toHaveLength(
      0,
    );
    expect(await listCalendarEvents(b.admin, { ...RANGE, user: a.admin.userId })).toMatchObject({
      ok: true,
    }); // an unknown id is just empty
    expect(
      must(await listCalendarEvents(b.admin, { ...RANGE, user: a.admin.userId })).events,
    ).toHaveLength(0);
  });
});
