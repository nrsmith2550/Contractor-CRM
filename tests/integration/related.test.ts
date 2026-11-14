import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount, createContact } from "@/server/domain/accounts";
import { createBooking, setBookingStatus } from "@/server/domain/bookings";
import { convertToWorkOrder, createCase } from "@/server/domain/cases";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { createOpportunity } from "@/server/domain/opportunities";
import { activateQuote, addLine, createQuote, winQuote } from "@/server/domain/quotes";
import { relatedRecords, type RelatedType } from "@/server/domain/related";
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
    companyName: `Links Co ${id}`,
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

/** title -> the hrefs listed under it. */
async function links(ctx: Ctx, type: RelatedType, id: string) {
  const r = must(await relatedRecords(ctx, type, id));
  return Object.fromEntries(r.groups.map((g) => [g.title, g.items.map((i) => i.href)]));
}

describe.skipIf(!enabled)("related records", () => {
  it("links a customer to its people, deals, quotes, orders, requests and jobs, and back again", async () => {
    const { admin: c } = await newBusiness();
    const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
    const other = must(await createAccount(c, { name: "Someone Else" })).account;
    const pers = must(
      await createContact(c, { lastName: "Ng", firstName: "Sam", parentAccountId: acct.id }),
    ).contact;
    const deal = must(
      await createOpportunity(c, { name: "Fence job", customerAccountId: acct.id }),
    ).opportunity;
    const q = must(
      await createQuote(c, {
        name: "Fence quote",
        opportunityId: deal.id,
        customerAccountId: acct.id,
      }),
    ).quote;
    must(await addLine(c, q.id, { description: "Fence", quantity: 1, unitPriceCents: 50_000 }));
    must(await activateQuote(c, q.id));
    const order = must(await winQuote(c, q.id)).order;
    const req = must(
      await createCase(c, { title: "Gate sticks", customerAccountId: acct.id }),
    ).case;
    const viaRequest = must(await convertToWorkOrder(c, req.id)).workOrder;
    const atSite = must(
      await createWorkOrder(c, { title: "Annual check", serviceAccountId: acct.id }),
    ).workOrder;
    // A job for a different customer must not show up.
    must(await createWorkOrder(c, { title: "Not theirs", serviceAccountId: other.id }));

    const cust = await links(c, "account", acct.id);
    expect(cust["People"]).toEqual([`/app/people/${pers.id}`]);
    expect(cust["Deals"]).toEqual([`/app/deals/${deal.id}`]);
    expect(cust["Quotes"]).toEqual([`/app/quotes/${q.id}`]);
    expect(cust["Orders"]).toEqual([`/app/orders/${order.id}`]);
    expect(cust["Support requests"]).toEqual([`/app/support-requests/${req.id}`]);
    expect(new Set(cust["Jobs"])).toEqual(
      new Set([`/app/jobs/${viaRequest.id}`, `/app/jobs/${atSite.id}`]),
    );

    // And from each of those, back to the customer and sideways to its neighbours.
    expect((await links(c, "contact", pers.id))["Customer"]).toEqual([`/app/customers/${acct.id}`]);
    const d = await links(c, "opportunity", deal.id);
    expect(d["Customer"]).toEqual([`/app/customers/${acct.id}`]);
    expect(d["Quotes"]).toEqual([`/app/quotes/${q.id}`]);
    expect(d["Orders"]).toEqual([`/app/orders/${order.id}`]);
    const qq = await links(c, "quote", q.id);
    expect(qq["Deal"]).toEqual([`/app/deals/${deal.id}`]);
    expect(qq["Orders"]).toEqual([`/app/orders/${order.id}`]);
    const oo = await links(c, "order", order.id);
    expect(oo["Quote"]).toEqual([`/app/quotes/${q.id}`]);
    expect(oo["Customer"]).toEqual([`/app/customers/${acct.id}`]);
    const rr = await links(c, "case", req.id);
    expect(rr["Jobs"]).toEqual([`/app/jobs/${viaRequest.id}`]);
    const jj = await links(c, "work_order", viaRequest.id);
    expect(jj["Support request"]).toEqual([`/app/support-requests/${req.id}`]);
    expect(jj["Customer"]).toEqual([`/app/customers/${acct.id}`]);
    // A job that stands alone still reaches its customer.
    expect((await links(c, "work_order", atSite.id))["Customer"]).toEqual([
      `/app/customers/${acct.id}`,
    ]);
  });

  it("never lists a record on its own page", async () => {
    const { admin: c } = await newBusiness();
    const q = must(await createQuote(c, { name: "Solo" })).quote;
    expect(await links(c, "quote", q.id)).toEqual({}); // its only 'other version' is itself
  });

  it("only links to what the viewer may read", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
    const req = must(
      await createCase(c, { title: "Gate sticks", customerAccountId: acct.id }),
    ).case;
    const job = must(await convertToWorkOrder(c, req.id)).workOrder;
    must(await createQuote(c, { name: "Fence quote", customerAccountId: acct.id }));

    // A field technician can read customers and jobs, but not support requests or quotes.
    const tech = await addUser(biz, "Field Technician");
    const asTech = await links(tech, "account", acct.id);
    expect(asTech["Jobs"]).toEqual([`/app/jobs/${job.id}`]);
    expect(asTech["Support requests"]).toBeUndefined();
    expect(asTech["Quotes"]).toBeUndefined();
    // On the job, the support request link is withheld too.
    expect((await links(tech, "work_order", job.id))["Support request"]).toBeUndefined();
    // And the related list of a record they cannot read is simply "not found".
    expect(await relatedRecords(tech, "case", req.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("is tenant-isolated and rejects bad input", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const acct = must(await createAccount(a.admin, { name: "Mine" })).account;
    expect(await relatedRecords(b.admin, "account", acct.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await relatedRecords(a.admin, "account", GHOST)).toMatchObject({ code: "not_found" });
    expect(await relatedRecords(a.admin, "account", "not-a-uuid")).toMatchObject({
      code: "not_found",
    });
    expect(await relatedRecords(a.admin, "product" as RelatedType, GHOST)).toMatchObject({
      code: "not_found",
    });
  });

  it("links jobs, customers and visits to each other, and shows each person only the visits they may read", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
    const req = must(
      await createCase(c, { title: "Gate sticks", customerAccountId: acct.id }),
    ).case;
    const job = must(await convertToWorkOrder(c, req.id)).workOrder;

    const techA = await addUser(biz, "Field Technician");
    const techB = await addUser(biz, "Field Technician");
    const resA = must(await createResource(c, { name: "Tech A", userId: techA.userId })).resource;
    const resB = must(await createResource(c, { name: "Tech B", userId: techB.userId })).resource;
    const day = (h: number) => new Date(Date.UTC(2030, 4, 1, h));
    const visitA = must(
      await createBooking(c, {
        workOrderId: job.id,
        resourceId: resA.id,
        startAt: day(9),
        endAt: day(11),
      }),
    ).booking;
    // A job has one live visit at a time: the first is called off, then the second tech takes it.
    must(await setBookingStatus(c, visitA.id, "cancelled"));
    const visitB = must(
      await createBooking(c, {
        workOrderId: job.id,
        resourceId: resB.id,
        startAt: day(13),
        endAt: day(15),
      }),
    ).booking;

    // The office sees both visits from the job and from the customer.
    const both = new Set([`/app/visits/${visitA.id}`, `/app/visits/${visitB.id}`]);
    expect(new Set((await links(c, "work_order", job.id))["Visits"])).toEqual(both);
    expect(new Set((await links(c, "account", acct.id))["Visits"])).toEqual(both);

    // A visit links up to its job, request and customer, and sideways to the job's other visits.
    const v = await links(c, "booking", visitA.id);
    expect(v["Job"]).toEqual([`/app/jobs/${job.id}`]);
    expect(v["Support request"]).toEqual([`/app/support-requests/${req.id}`]);
    expect(v["Customer"]).toEqual([`/app/customers/${acct.id}`]);
    expect(v["Other visits for this job"]).toEqual([`/app/visits/${visitB.id}`]);

    // A technician sees only their own visit on the job; the support request stays hidden from them.
    const asA = await links(techA, "work_order", job.id);
    expect(asA["Visits"]).toEqual([`/app/visits/${visitA.id}`]);
    const fromVisit = await links(techA, "booking", visitA.id);
    expect(fromVisit["Support request"]).toBeUndefined();
    expect(fromVisit["Other visits for this job"]).toBeUndefined(); // the other visit is not theirs
    // ...and cannot open someone else's visit's related records at all.
    expect(await relatedRecords(techA, "booking", visitB.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});
