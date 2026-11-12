import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createBooking } from "@/server/domain/bookings";
import { createProduct } from "@/server/domain/catalog";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { createResource } from "@/server/domain/resources";
import {
  addLabour,
  addPart,
  listWorkOrderLines,
  removeLabour,
  removePart,
} from "@/server/domain/work-order-lines";
import { createWorkOrder, setWorkOrderStatus } from "@/server/domain/work-orders";
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
  const filter = must(
    await createProduct(biz.admin, {
      sku: `F-${rand()}`,
      name: "Furnace filter",
      listPriceCents: 2499,
    }),
  ).product;
  const wo = must(await createWorkOrder(dispatcher, { title: "Service the furnace" })).workOrder;
  return { biz, admin: biz.admin, dispatcher, tech, resource, filter, wo };
}
const book = async (c: Ctx, workOrderId: string, resourceId: string) =>
  must(
    await createBooking(c, {
      workOrderId,
      resourceId,
      startAt: "2030-05-01T09:00:00Z",
      endAt: "2030-05-01T10:00:00Z",
    }),
  ).booking;

describe.skipIf(!enabled)("Work order parts and labour", () => {
  it("prices parts from the catalog or a write-in, and labour by the minute, to the cent", async () => {
    const { biz, dispatcher, filter, wo, resource } = await setup();
    const a = must(await addPart(dispatcher, wo.id, { productId: filter.id, quantity: 2 })).part;
    expect(a).toMatchObject({
      lineNumber: 1,
      description: "Furnace filter",
      quantityMilli: 2000,
      unitPriceCents: 2499,
      extendedCents: 4998,
    });
    const b = must(
      await addPart(dispatcher, wo.id, {
        description: "Igniter (special order)",
        quantity: 1,
        unitPriceCents: 8950,
      }),
    ).part;
    expect(b).toMatchObject({ lineNumber: 2, productId: null, extendedCents: 8950 });
    const half = must(
      await addPart(dispatcher, wo.id, {
        description: "Sealant, per metre",
        quantity: 2.5,
        unitPriceCents: 101,
      }),
    ).part;
    expect(half.extendedCents).toBe(253); // 252.5 rounds up

    const l1 = must(
      await addLabour(dispatcher, wo.id, {
        description: "Diagnosis and repair",
        minutes: 90,
        hourlyRateCents: 9500,
        resourceId: resource.id,
      }),
    ).labour;
    expect(l1).toMatchObject({
      lineNumber: 1,
      minutes: 90,
      hourlyRateCents: 9500,
      extendedCents: 14250,
      resourceId: resource.id,
    });
    expect(
      must(
        await addLabour(dispatcher, wo.id, {
          description: "Travel",
          minutes: 7,
          hourlyRateCents: 9500,
        }),
      ).labour.extendedCents,
    ).toBe(1108); // 1108.33

    const lines = must(await listWorkOrderLines(dispatcher, wo.id));
    expect(lines.partsCents).toBe(4998 + 8950 + 253);
    expect(lines.labourCents).toBe(14250 + 1108);
    expect(lines.totalCents).toBe(lines.partsCents + lines.labourCents);
    expect(lines.parts.map((p) => p.lineNumber)).toEqual([1, 2, 3]);
    const audit = (await auditOf(biz.tenantId, wo.id)).map((x) => x.action);
    expect(audit).toEqual(expect.arrayContaining(["add_part", "add_labour"]));
  });

  it("removing a line renumbers the rest and the totals follow", async () => {
    const { dispatcher, wo } = await setup();
    const ids: string[] = [];
    for (const [d, price] of [
      ["A", 100],
      ["B", 200],
      ["C", 400],
    ] as const)
      ids.push(
        must(
          await addPart(dispatcher, wo.id, { description: d, quantity: 1, unitPriceCents: price }),
        ).part.id,
      );
    must(await removePart(dispatcher, wo.id, ids[0]!));
    const lines = must(await listWorkOrderLines(dispatcher, wo.id));
    expect(lines.parts.map((p) => [p.lineNumber, p.description])).toEqual([
      [1, "B"],
      [2, "C"],
    ]);
    expect(lines.partsCents).toBe(600);
    expect(await removePart(dispatcher, wo.id, ids[0]!)).toMatchObject({
      ok: false,
      code: "not_found",
    });

    const l = must(
      await addLabour(dispatcher, wo.id, {
        description: "Work",
        minutes: 60,
        hourlyRateCents: 5000,
      }),
    ).labour;
    must(await removeLabour(dispatcher, wo.id, l.id));
    expect(must(await listWorkOrderLines(dispatcher, wo.id)).labour).toHaveLength(0);
    expect(await removeLabour(dispatcher, wo.id, l.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("validates parts and labour", async () => {
    const { dispatcher, wo, filter } = await setup();
    const part = (v: Record<string, unknown>) => addPart(dispatcher, wo.id, v);
    expect(await part({ description: "x", quantity: 0, unitPriceCents: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await part({ description: "x", quantity: -1, unitPriceCents: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await part({ quantity: 1, unitPriceCents: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    }); // a write-in needs a description
    expect(await part({ description: "x", quantity: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    }); // and a price
    expect(await part({ description: "x", quantity: 1, unitPriceCents: 1.5 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await part({ productId: GHOST, quantity: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await part({ productId: filter.id, quantity: 1, unitPriceCents: 0 })).toMatchObject({
      ok: true,
    }); // a free part is allowed

    const labour = (v: Record<string, unknown>) => addLabour(dispatcher, wo.id, v);
    expect(await labour({ description: "", minutes: 30, hourlyRateCents: 100 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await labour({ description: "x", minutes: 0, hourlyRateCents: 100 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await labour({ description: "x", minutes: 1.5, hourlyRateCents: 100 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await labour({ description: "x", minutes: 30, hourlyRateCents: -1 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await labour({ description: "x", minutes: 30, hourlyRateCents: 100, resourceId: GHOST }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await addPart(dispatcher, "not-a-uuid", { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await listWorkOrderLines(dispatcher, wo.id)).labour).toHaveLength(0);
  });

  it("can be recorded until the work order is posted or cancelled", async () => {
    const { admin, dispatcher, wo } = await setup();
    const add = () =>
      addPart(dispatcher, wo.id, { description: "x", quantity: 1, unitPriceCents: 100 });
    must(await add()); // unscheduled
    for (const s of ["scheduled", "in_progress", "completed"]) {
      must(await setWorkOrderStatus(admin, wo.id, s));
      must(await add());
    }
    const part = must(await listWorkOrderLines(dispatcher, wo.id)).parts[0]!;
    must(await setWorkOrderStatus(admin, wo.id, "posted"));
    expect(await add()).toMatchObject({ ok: false, code: "read_only" });
    expect(
      await addLabour(dispatcher, wo.id, { description: "x", minutes: 5, hourlyRateCents: 100 }),
    ).toMatchObject({ ok: false, code: "read_only" });
    expect(await removePart(dispatcher, wo.id, part.id)).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(must(await listWorkOrderLines(dispatcher, wo.id)).parts).toHaveLength(4); // still readable

    const other = must(await createWorkOrder(dispatcher, { title: "Cancelled job" })).workOrder;
    must(await setWorkOrderStatus(admin, other.id, "cancelled"));
    expect(
      await addPart(dispatcher, other.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "read_only" });
  });

  it("a technician booked on the job records parts (and removes their own), but never labour rates", async () => {
    const { biz, dispatcher, tech, resource, wo, filter } = await setup();
    // Not booked yet: no access to change anything.
    expect(await addPart(tech, wo.id, { productId: filter.id, quantity: 1 })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    await book(dispatcher, wo.id, resource.id);

    const mine = must(await addPart(tech, wo.id, { productId: filter.id, quantity: 1 })).part;
    expect(mine).toMatchObject({ addedBy: tech.userId, unitPriceCents: 2499 });
    const theirs = must(
      await addPart(dispatcher, wo.id, {
        description: "Dispatcher's part",
        quantity: 1,
        unitPriceCents: 500,
      }),
    ).part;
    expect(
      await addLabour(tech, wo.id, {
        description: "Self-assigned labour",
        minutes: 600,
        hourlyRateCents: 99999,
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(await removeLabour(tech, wo.id, GHOST)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await removePart(tech, wo.id, theirs.id)).toMatchObject({
      ok: false,
      code: "forbidden",
    }); // not theirs
    must(await removePart(tech, wo.id, mine.id)); // their own
    expect(must(await listWorkOrderLines(tech, wo.id)).parts.map((p) => p.id)).toEqual([theirs.id]); // technicians can read

    // Another technician, not booked on this job, can read but not change.
    const tech2 = await addUser(biz, "Field Technician");
    expect(must(await listWorkOrderLines(tech2, wo.id)).totalCents).toBe(500);
    expect(
      await addPart(tech2, wo.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("roles and other businesses", async () => {
    const a = await setup();
    const b = await setup();
    const viewer = await addUser(a.biz, "Read-only");
    expect(must(await listWorkOrderLines(viewer, a.wo.id)).parts).toHaveLength(0);
    expect(
      await addPart(viewer, a.wo.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    const sales = await addUser(a.biz, "Salesperson");
    expect(await listWorkOrderLines(sales, a.wo.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await addPart(sales, a.wo.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });

    must(
      await addPart(a.dispatcher, a.wo.id, {
        description: "A's part",
        quantity: 1,
        unitPriceCents: 100,
      }),
    );
    expect(await listWorkOrderLines(b.admin, a.wo.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await addPart(b.admin, a.wo.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await addLabour(b.admin, a.wo.id, { description: "x", minutes: 5, hourlyRateCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await listWorkOrderLines(a.admin, a.wo.id)).totalCents).toBe(100);
  });
});
