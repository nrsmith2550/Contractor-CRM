import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, resourceBooking, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import {
  createBooking,
  getBooking,
  listBookings,
  listMyBookings,
  moveBooking,
  setBookingStatus,
} from "@/server/domain/bookings";
import { convertToWorkOrder, createCase } from "@/server/domain/cases";
import { buildCtx, type Ctx } from "@/server/domain/context";
import {
  createCharacteristic,
  createResource,
  getResource,
  listCharacteristics,
  listResources,
  listWorkOrderSkills,
  setWorkOrderSkills,
  updateResource,
} from "@/server/domain/resources";
import { createWorkOrder, getWorkOrder, setWorkOrderStatus } from "@/server/domain/work-orders";
import { defaultWorkHours } from "@/server/domain/work-hours";
import type { Email } from "@/server/email/mailer";
import { mintLicense } from "@/server/licensing/mint";
import { PNG_1PX } from "../support/images";

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

// 2030-05-01 is a Wednesday; the test businesses run in UTC, so default hours are 08:00-17:00Z.
const D = (hhmm: string, day = "2030-05-01") => `${day}T${hhmm}:00Z`;
const auditOf = (tenantId: string, recordId: string) =>
  withTenant(tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.recordId, recordId)));
const codes = (r: { warnings: { code: string }[] }) => r.warnings.map((w) => w.code).sort();

async function setup() {
  const biz = await newBusiness();
  const dispatcher = await addUser(biz, "Customer Service Rep");
  const tech = await addUser(biz, "Field Technician");
  const resource = must(
    await createResource(biz.admin, { name: "Tech A", userId: tech.userId, color: "#3366cc" }),
  ).resource;
  const wo = async (title = "Job") => must(await createWorkOrder(dispatcher, { title })).workOrder;
  return { biz, admin: biz.admin, dispatcher, tech, resource, wo };
}

describe.skipIf(!enabled)("Phase 4 acceptance: the technician's visit", () => {
  it("Technician can move a booking through Travelling -> In Progress -> Completed and capture a signature", async () => {
    const { biz, dispatcher, tech, resource, wo } = await setup();
    const job = await wo("Furnace repair");
    const booked = must(
      await createBooking(dispatcher, {
        workOrderId: job.id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("11:00"),
        notes: "Gate code 4411",
      }),
    );
    expect(booked.warnings).toEqual([]);
    expect(booked.booking).toMatchObject({
      status: "scheduled",
      ownerId: tech.userId,
      resourceId: resource.id,
    });
    expect(must(await getWorkOrder(dispatcher, job.id)).workOrder.status).toBe("scheduled");

    // The technician sees it in their own list, with the job's details.
    const mine = must(
      await listMyBookings(tech, { from: new Date(D("00:00")), to: new Date(D("23:59")) }),
    ).rows;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      id: booked.booking.id,
      woNumber: job.woNumber,
      woTitle: "Furnace repair",
      resourceName: "Tech A",
    });

    const id = booked.booking.id;
    const travelling = must(await setBookingStatus(tech, id, "travelling")).booking;
    expect(travelling).toMatchObject({ status: "travelling" });
    expect(travelling.travellingAt).toBeInstanceOf(Date);

    const started = must(await setBookingStatus(tech, id, "in_progress")).booking;
    expect(started.startedAt).toBeInstanceOf(Date);
    expect(must(await getWorkOrder(dispatcher, job.id)).workOrder.status).toBe("in_progress");

    const done = must(
      await setBookingStatus(tech, id, "completed", {
        signatureDataUrl: PNG_1PX,
        signedByName: "  Pat Customer ",
        notes: "Replaced igniter",
      }),
    ).booking;
    expect(done).toMatchObject({
      status: "completed",
      signatureDataUrl: PNG_1PX,
      signedByName: "Pat Customer",
    });
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.signedAt).toBeInstanceOf(Date);
    expect(done.notes).toBe("Gate code 4411\nReplaced igniter");
    expect(must(await getWorkOrder(dispatcher, job.id)).workOrder.status).toBe("completed");

    const actions = (await auditOf(biz.tenantId, id)).map((a) => a.action);
    expect(actions.filter((a) => a === "status")).toHaveLength(3);
    expect(JSON.stringify((await auditOf(biz.tenantId, id)).map((a) => a.changes))).toContain(
      "signed",
    );
    // The audit trail never contains the signature image itself.
    expect(JSON.stringify(await auditOf(biz.tenantId, id))).not.toContain("iVBOR");
  });
});

describe.skipIf(!enabled)("Booking status rules", () => {
  it("follows the flow, lets a technician already on site start directly, and refuses the rest", async () => {
    const { dispatcher, tech, resource, wo } = await setup();
    const job = await wo();
    const id = must(
      await createBooking(dispatcher, {
        workOrderId: job.id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking.id;
    expect(await setBookingStatus(tech, id, "completed")).toMatchObject({
      ok: false,
      code: "conflict",
    }); // can't skip
    expect(await setBookingStatus(tech, id, "nonsense")).toMatchObject({
      ok: false,
      code: "invalid",
    });
    must(await setBookingStatus(tech, id, "travelling"));
    expect(must(await setBookingStatus(tech, id, "scheduled")).booking.travellingAt).toBeNull(); // turned around
    must(await setBookingStatus(tech, id, "in_progress")); // directly from scheduled
    expect(await setBookingStatus(tech, id, "cancelled")).toMatchObject({
      ok: false,
      code: "conflict",
    }); // work has started
    expect(await setBookingStatus(tech, id, "scheduled")).toMatchObject({
      ok: false,
      code: "conflict",
    });
    must(await setBookingStatus(tech, id, "completed"));
    expect(await setBookingStatus(tech, id, "in_progress")).toMatchObject({
      ok: false,
      code: "conflict",
    });
  });

  it("validates the signature", async () => {
    const { dispatcher, tech, resource, wo } = await setup();
    const id = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking.id;
    must(await setBookingStatus(tech, id, "in_progress"));
    const jpeg =
      "data:image/jpeg;base64," +
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]).toString("base64");
    const spoof = "data:image/png;base64," + Buffer.from("not really a png").toString("base64");
    const big =
      "data:image/png;base64," +
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(101 * 1024),
      ]).toString("base64");
    for (const bad of [
      jpeg,
      spoof,
      big,
      "https://example.com/sig.png",
      "data:image/svg+xml;base64,PHN2Zy8+",
    ]) {
      expect(
        await setBookingStatus(tech, id, "completed", {
          signatureDataUrl: bad,
          signedByName: "Pat",
        }),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
    expect(
      await setBookingStatus(tech, id, "completed", { signatureDataUrl: PNG_1PX }),
    ).toMatchObject({ ok: false, code: "invalid" }); // needs a name
    expect(
      await setBookingStatus(tech, id, "completed", {
        signatureDataUrl: PNG_1PX,
        signedByName: "  ",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(must(await getBooking(dispatcher, id)).booking.status).toBe("in_progress"); // nothing changed
    // Completing without a signature is allowed.
    expect(must(await setBookingStatus(tech, id, "completed")).booking.signatureDataUrl).toBeNull();
  });

  it("a signature only goes with completion", async () => {
    const { dispatcher, tech, resource, wo } = await setup();
    const id = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking.id;
    expect(
      await setBookingStatus(tech, id, "travelling", {
        signatureDataUrl: PNG_1PX,
        signedByName: "Pat",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("cancelling an unstarted booking unschedules the work order and frees it to be rebooked", async () => {
    const { dispatcher, resource, wo } = await setup();
    const job = await wo();
    const first = must(
      await createBooking(dispatcher, {
        workOrderId: job.id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;
    expect(
      await createBooking(dispatcher, {
        workOrderId: job.id,
        resourceId: resource.id,
        startAt: D("13:00"),
        endAt: D("14:00"),
      }),
    ).toMatchObject({ ok: false, code: "conflict" }); // already booked
    must(await setBookingStatus(dispatcher, first.id, "cancelled"));
    expect(must(await getWorkOrder(dispatcher, job.id)).workOrder.status).toBe("unscheduled");
    const second = must(
      await createBooking(dispatcher, {
        workOrderId: job.id,
        resourceId: resource.id,
        startAt: D("13:00"),
        endAt: D("14:00"),
      }),
    ).booking;
    expect(must(await getWorkOrder(dispatcher, job.id)).workOrder.status).toBe("scheduled");
    expect(second.id).not.toBe(first.id);
  });
});

describe.skipIf(!enabled)("Booking warnings", () => {
  it("warns about overlap, outside hours, missing skills and the customer's window, but still books", async () => {
    const { admin, dispatcher, resource, wo } = await setup();
    const hvac = must(await createCharacteristic(admin, { name: "HVAC certified" })).characteristic;
    const gas = must(await createCharacteristic(admin, { name: "Gas fitter" })).characteristic;
    must(await updateResource(admin, resource.id, { skillIds: [hvac.id] }));

    const a = await wo("First");
    expect(
      must(
        await createBooking(dispatcher, {
          workOrderId: a.id,
          resourceId: resource.id,
          startAt: D("09:00"),
          endAt: D("11:00"),
        }),
      ).warnings,
    ).toEqual([]);

    // Overlaps the first booking.
    const b = await wo("Second");
    const overlap = must(
      await createBooking(dispatcher, {
        workOrderId: b.id,
        resourceId: resource.id,
        startAt: D("10:00"),
        endAt: D("12:00"),
      }),
    );
    expect(codes(overlap)).toEqual(["overlap"]);
    expect(overlap.warnings[0]!.message).toContain(a.woNumber);
    expect(overlap.booking.status).toBe("scheduled"); // booked anyway

    // Back to back is fine.
    const c = await wo("Third");
    expect(
      codes(
        must(
          await createBooking(dispatcher, {
            workOrderId: c.id,
            resourceId: resource.id,
            startAt: D("12:00"),
            endAt: D("13:00"),
          }),
        ),
      ),
    ).toEqual([]);

    // Outside working hours, and on a day off.
    const d = await wo("Fourth");
    expect(
      codes(
        must(
          await createBooking(dispatcher, {
            workOrderId: d.id,
            resourceId: resource.id,
            startAt: D("16:00"),
            endAt: D("18:00"),
          }),
        ),
      ),
    ).toEqual(["outside_hours"]);
    const e = await wo("Fifth");
    expect(
      codes(
        must(
          await createBooking(dispatcher, {
            workOrderId: e.id,
            resourceId: resource.id,
            startAt: D("09:00", "2030-05-04"),
            endAt: D("10:00", "2030-05-04"),
          }),
        ),
      ),
    ).toEqual(["outside_hours"]); // Saturday

    // A required skill the resource lacks.
    const f = await wo("Sixth");
    must(await setWorkOrderSkills(dispatcher, f.id, [hvac.id, gas.id]));
    const skills = must(
      await createBooking(dispatcher, {
        workOrderId: f.id,
        resourceId: resource.id,
        startAt: D("09:00", "2030-05-02"),
        endAt: D("10:00", "2030-05-02"),
      }),
    );
    expect(codes(skills)).toEqual(["missing_skills"]);
    expect(skills.warnings[0]!.message).toContain("Gas fitter");
    expect(skills.warnings[0]!.message).not.toContain("HVAC");

    // Outside the customer's time window.
    const g = must(
      await createWorkOrder(dispatcher, {
        title: "Windowed",
        timeWindowStart: D("13:00", "2030-05-03"),
        timeWindowEnd: D("15:00", "2030-05-03"),
      }),
    ).workOrder;
    expect(
      codes(
        must(
          await createBooking(dispatcher, {
            workOrderId: g.id,
            resourceId: resource.id,
            startAt: D("09:00", "2030-05-03"),
            endAt: D("10:00", "2030-05-03"),
          }),
        ),
      ),
    ).toEqual(["outside_window"]);
    const h = must(
      await createWorkOrder(dispatcher, {
        title: "Inside",
        timeWindowStart: D("13:00", "2030-05-06"),
        timeWindowEnd: D("15:00", "2030-05-06"),
      }),
    ).workOrder;
    expect(
      codes(
        must(
          await createBooking(dispatcher, {
            workOrderId: h.id,
            resourceId: resource.id,
            startAt: D("13:30", "2030-05-06"),
            endAt: D("14:30", "2030-05-06"),
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("a cancelled booking no longer blocks the time, and moving ignores the booking itself", async () => {
    const { dispatcher, resource, wo } = await setup();
    const a = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("11:00"),
      }),
    ).booking;
    must(await setBookingStatus(dispatcher, a.id, "cancelled"));
    expect(
      codes(
        must(
          await createBooking(dispatcher, {
            workOrderId: (await wo()).id,
            resourceId: resource.id,
            startAt: D("09:30"),
            endAt: D("10:30"),
          }),
        ),
      ),
    ).toEqual([]);

    const mine = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("14:00"),
        endAt: D("15:00"),
      }),
    ).booking;
    const moved = must(
      await moveBooking(dispatcher, mine.id, { startAt: D("14:30"), endAt: D("15:30") }),
    ); // overlaps only its old self
    expect(moved.warnings).toEqual([]);
    expect(moved.booking.startAt.toISOString()).toBe("2030-05-01T14:30:00.000Z");
    expect((await auditOf(dispatcher.tenantId, mine.id)).map((x) => x.action)).toContain("move");
  });
});

describe.skipIf(!enabled)("Creating, moving and listing bookings", () => {
  it("validates the booking", async () => {
    const { admin, dispatcher, resource, wo } = await setup();
    const job = await wo();
    const base = { workOrderId: job.id, resourceId: resource.id };
    expect(
      await createBooking(dispatcher, { ...base, startAt: D("10:00"), endAt: D("09:00") }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createBooking(dispatcher, { ...base, startAt: D("10:00"), endAt: D("10:00") }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createBooking(dispatcher, {
        ...base,
        startAt: D("10:00"),
        endAt: D("10:00", "2030-05-20"),
      }),
    ).toMatchObject({ ok: false, code: "invalid" }); // over 14 days
    expect(
      await createBooking(dispatcher, { ...base, startAt: "garbage", endAt: D("10:00") }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createBooking(dispatcher, {
        ...base,
        resourceId: "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11",
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createBooking(dispatcher, {
        ...base,
        workOrderId: "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11",
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).toMatchObject({ ok: false, code: "not_found" });
    // Work that is finished can't be booked.
    for (const s of ["scheduled", "in_progress", "completed"])
      must(await setWorkOrderStatus(admin, job.id, s));
    expect(
      await createBooking(dispatcher, { ...base, startAt: D("09:00"), endAt: D("10:00") }),
    ).toMatchObject({ ok: false, code: "conflict" });
  });

  it("moves a scheduled booking to another resource, which changes whose it is", async () => {
    const { biz, admin, dispatcher, tech, resource, wo } = await setup();
    const tech2 = await addUser(biz, "Field Technician");
    const other = must(
      await createResource(admin, { name: "Tech B", userId: tech2.userId }),
    ).resource;
    const booking = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;
    expect(
      must(await listMyBookings(tech, { from: new Date(D("00:00")), to: new Date(D("23:59")) }))
        .rows,
    ).toHaveLength(1);

    const moved = must(
      await moveBooking(dispatcher, booking.id, {
        resourceId: other.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;
    expect(moved).toMatchObject({ resourceId: other.id, ownerId: tech2.userId });
    expect(
      must(await listMyBookings(tech, { from: new Date(D("00:00")), to: new Date(D("23:59")) }))
        .rows,
    ).toHaveLength(0);
    expect(
      must(await listMyBookings(tech2, { from: new Date(D("00:00")), to: new Date(D("23:59")) }))
        .rows,
    ).toHaveLength(1);

    must(await setBookingStatus(tech2, booking.id, "in_progress"));
    expect(
      await moveBooking(dispatcher, booking.id, { startAt: D("11:00"), endAt: D("12:00") }),
    ).toMatchObject({ ok: false, code: "read_only" }); // started
  });

  it("lists bookings in a range, by resource, hiding cancelled ones unless asked", async () => {
    const { admin, dispatcher, resource, wo } = await setup();
    const other = must(await createResource(admin, { name: "Tech B" })).resource;
    const a = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo("A")).id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;
    must(
      await createBooking(dispatcher, {
        workOrderId: (await wo("B")).id,
        resourceId: other.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    );
    const c = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo("C")).id,
        resourceId: resource.id,
        startAt: D("09:00", "2030-05-02"),
        endAt: D("10:00", "2030-05-02"),
      }),
    ).booking;
    must(await setBookingStatus(dispatcher, c.id, "cancelled"));

    const day = { from: new Date(D("00:00")), to: new Date(D("23:59")) };
    expect(must(await listBookings(dispatcher, day)).rows).toHaveLength(2);
    expect(
      must(await listBookings(dispatcher, { ...day, resourceId: resource.id })).rows.map(
        (r) => r.id,
      ),
    ).toEqual([a.id]);
    const week = { from: new Date(D("00:00")), to: new Date(D("23:59", "2030-05-07")) };
    expect(must(await listBookings(dispatcher, week)).rows).toHaveLength(2);
    expect(
      must(await listBookings(dispatcher, { ...week, includeCancelled: true })).rows,
    ).toHaveLength(3);
    expect(must(await listBookings(dispatcher, day)).rows[0]).toMatchObject({
      resourceName: expect.any(String),
      woNumber: expect.stringMatching(/^WO-/),
    });
  });

  it("booking from a case's converted work order works end to end", async () => {
    const { dispatcher, resource } = await setup();
    const k = must(await createCase(dispatcher, { title: "No heat" })).case;
    const job = must(await convertToWorkOrder(dispatcher, k.id)).workOrder;
    expect(job.status).toBe("unscheduled");
    must(
      await createBooking(dispatcher, {
        workOrderId: job.id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("11:00"),
      }),
    );
    expect(must(await getWorkOrder(dispatcher, job.id)).workOrder.status).toBe("scheduled");
  });
});

describe.skipIf(!enabled)("Resources and skills", () => {
  it("administrators create skills and resources; others can look", async () => {
    const { biz, admin, dispatcher, tech } = await setup();
    expect(await createCharacteristic(dispatcher, { name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await createResource(dispatcher, { name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await createCharacteristic(admin, { name: " " })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const s = must(await createCharacteristic(admin, { name: "Electrician" })).characteristic;
    expect(await createCharacteristic(admin, { name: "Electrician" })).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(must(await listCharacteristics(dispatcher)).rows.map((r) => r.name)).toEqual([
      "Electrician",
    ]);

    const r = must(
      await createResource(admin, { name: "Crew 1", resourceType: "crew", skillIds: [s.id, s.id] }),
    );
    expect(r.skillIds).toEqual([s.id]); // de-duplicated
    expect(r.resource.workHours).toEqual(defaultWorkHours());
    expect(await createResource(admin, { name: "Crew 1" })).toMatchObject({
      ok: false,
      code: "conflict",
    });
    expect(must(await getResource(tech, r.resource.id)).skillIds).toEqual([s.id]);
    expect(
      must(await listResources(dispatcher)).rows.some(
        (x) => x.name === "Crew 1" && x.skillIds.length === 1,
      ),
    ).toBe(true);
    expect(await updateResource(tech, r.resource.id, { name: "Hacked" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect((await auditOf(biz.tenantId, r.resource.id)).map((a) => a.action)).toContain("create");
  });

  it("validates resources: type, colour, work hours, user and skills", async () => {
    const { admin } = await setup();
    expect(await createResource(admin, { name: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createResource(admin, { name: "x", resourceType: "robot" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createResource(admin, { name: "x", color: "blue" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await createResource(admin, { name: "x", userId: "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11" }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createResource(admin, {
        name: "x",
        skillIds: ["7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11"],
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    const hours = defaultWorkHours();
    hours.mon = [{ start: "17:00", end: "08:00" }];
    expect(await createResource(admin, { name: "x", workHours: hours })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const ok = defaultWorkHours();
    ok.sat = [{ start: "09:00", end: "13:00" }];
    expect(
      must(await createResource(admin, { name: "Weekender", workHours: ok })).resource.workHours
        .sat,
    ).toEqual([{ start: "09:00", end: "13:00" }]);
  });

  it("changes a resource's skills and a work order's required skills", async () => {
    const { admin, dispatcher, resource, wo } = await setup();
    const a = must(await createCharacteristic(admin, { name: "A" })).characteristic;
    const b = must(await createCharacteristic(admin, { name: "B" })).characteristic;
    expect(
      must(await updateResource(admin, resource.id, { skillIds: [a.id, b.id] })).skillIds.sort(),
    ).toEqual([a.id, b.id].sort());
    expect(must(await updateResource(admin, resource.id, { skillIds: [b.id] })).skillIds).toEqual([
      b.id,
    ]);
    expect(must(await updateResource(admin, resource.id, { name: "Renamed" })).skillIds).toEqual([
      b.id,
    ]); // untouched when omitted

    const job = await wo();
    expect(must(await setWorkOrderSkills(dispatcher, job.id, [a.id, b.id])).skillIds).toHaveLength(
      2,
    );
    expect(must(await listWorkOrderSkills(dispatcher, job.id)).skills.map((s) => s.name)).toEqual([
      "A",
      "B",
    ]);
    expect(must(await setWorkOrderSkills(dispatcher, job.id, [])).skillIds).toEqual([]);
    expect(
      await setWorkOrderSkills(dispatcher, job.id, ["7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11"]),
    ).toMatchObject({ ok: false, code: "invalid" });
    for (const s of ["scheduled", "in_progress", "completed"])
      must(await setWorkOrderStatus(admin, job.id, s));
    expect(await setWorkOrderSkills(dispatcher, job.id, [a.id])).toMatchObject({
      ok: false,
      code: "read_only",
    });
  });
});

describe.skipIf(!enabled)("Booking permissions and isolation", () => {
  it("technicians run their own bookings but can't book, move, or touch others'", async () => {
    const { biz, admin, dispatcher, tech, resource, wo } = await setup();
    const tech2 = await addUser(biz, "Field Technician");
    const other = must(
      await createResource(admin, { name: "Tech B", userId: tech2.userId }),
    ).resource;
    const mine = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;
    const theirs = must(
      await createBooking(dispatcher, {
        workOrderId: (await wo()).id,
        resourceId: other.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;

    expect(
      await createBooking(tech, {
        workOrderId: (await wo()).id,
        resourceId: resource.id,
        startAt: D("12:00"),
        endAt: D("13:00"),
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    // Moving a visit is the dispatcher's job, even though the technician owns the booking.
    expect(
      await moveBooking(tech, mine.id, { startAt: D("11:00"), endAt: D("12:00") }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(await setBookingStatus(tech, theirs.id, "travelling")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await getBooking(tech, theirs.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(
      must(
        await listBookings(tech, { from: new Date(D("00:00")), to: new Date(D("23:59")) }),
      ).rows.map((r) => r.id),
    ).toEqual([mine.id]);
    // A technician can't edit the work order directly, only run their booking.
    expect(await setWorkOrderStatus(tech, (await wo()).id, "scheduled")).toMatchObject({
      ok: false,
      code: "forbidden",
    });

    const viewer = await addUser(biz, "Read-only");
    expect(
      must(await listBookings(viewer, { from: new Date(D("00:00")), to: new Date(D("23:59")) }))
        .rows,
    ).toHaveLength(2);
    expect(await setBookingStatus(viewer, mine.id, "travelling")).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const sales = await addUser(biz, "Salesperson");
    expect(
      await listBookings(sales, { from: new Date(D("00:00")), to: new Date(D("23:59")) }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      await listMyBookings(sales, { from: new Date(D("00:00")), to: new Date(D("23:59")) }),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("another business can't see or touch bookings, resources or skills", async () => {
    const a = await setup();
    const b = await setup();
    const job = await a.wo();
    const booking = must(
      await createBooking(a.dispatcher, {
        workOrderId: job.id,
        resourceId: a.resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).booking;
    expect(await getBooking(b.admin, booking.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await setBookingStatus(b.admin, booking.id, "travelling")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await moveBooking(b.admin, booking.id, { startAt: D("11:00"), endAt: D("12:00") }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await createBooking(b.admin, {
        workOrderId: job.id,
        resourceId: b.resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await createBooking(b.admin, {
        workOrderId: (await b.wo()).id,
        resourceId: a.resource.id,
        startAt: D("09:00"),
        endAt: D("10:00"),
      }),
    ).toMatchObject({ ok: false, code: "invalid" }); // A's resource doesn't exist for B
    expect(await getResource(b.admin, a.resource.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(must(await listResources(b.admin)).rows.every((r) => r.id !== a.resource.id)).toBe(true);
    const rows = await withTenant(b.biz.tenantId, (tx) => tx.select().from(resourceBooking));
    expect(rows).toHaveLength(0);
  });
});
