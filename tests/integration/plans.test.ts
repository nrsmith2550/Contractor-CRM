import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withPlatform } from "@/db/client";
import { license } from "@/db/schema";
import type { Edition } from "@/lib/plans";
import { activateLicense } from "@/server/auth/activation";
import { createAccount, createContact } from "@/server/domain/accounts";
import { createBooking } from "@/server/domain/bookings";
import { createCase, listCases } from "@/server/domain/cases";
import { buildCtx } from "@/server/domain/context";
import { salesDashboard, serviceDashboard } from "@/server/domain/dashboards";
import { createLead } from "@/server/domain/leads";
import { createOpportunity } from "@/server/domain/opportunities";
import { createQuote } from "@/server/domain/quotes";
import { relatedRecords } from "@/server/domain/related";
import { createWorkOrder, listWorkOrders } from "@/server/domain/work-orders";
import { mintLicense } from "@/server/licensing/mint";
import { OPS } from "@/server/entities/registry";
import { tenantEdition } from "@/server/entities/tenant";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const NOW = { now: new Date(), tz: "UTC" };

async function business(edition?: Edition) {
  const { key, licenseId } = await mintLicense({ edition });
  const id = rand();
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Plan Co ${id}`,
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
    userId: res.userId,
    licenseId,
    ctx: () => buildCtx(res.tenantId, res.userId),
  };
}

const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};
const FORBIDDEN = { ok: false, code: "forbidden" };

describe.skipIf(!enabled)("plans: a licence only unlocks the part it was bought for", () => {
  it("a licence is the full suite unless said otherwise, with the standard users", async () => {
    const b = await business();
    expect(await tenantEdition(b.tenantId)).toBe("complete");
    const [lic] = await withPlatform((tx) =>
      tx.select().from(license).where(eq(license.id, b.licenseId)),
    );
    expect(lic).toMatchObject({ edition: "complete", seatLimit: 10 });
  });

  it("Clinch Deals: prospects, deals and quotes work; support requests, jobs and visits do not", async () => {
    const b = await business("deals");
    const c = await b.ctx();
    expect(c.subject.edition).toBe("deals");

    must(await createLead(c, { lastName: "Ng", companyName: "Ng Co" }));
    must(await createOpportunity(c, { name: "Fence" }));
    must(await createQuote(c, { name: "Fence quote" }));
    // Shared parts are always there.
    const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
    must(await createContact(c, { lastName: "Ng", parentAccountId: acct.id }));

    expect(await createCase(c, { title: "Gate sticks" })).toMatchObject(FORBIDDEN);
    expect(await createWorkOrder(c, { title: "Repair" })).toMatchObject(FORBIDDEN);
    expect(
      await createBooking(c, {
        workOrderId: acct.id,
        resourceId: acct.id,
        startAt: new Date(),
        endAt: new Date(),
      }),
    ).toMatchObject(FORBIDDEN);
    expect(await listCases(c, { view: "all_active" })).toMatchObject({ ok: false });
    expect(await listWorkOrders(c, { view: "all_open" })).toMatchObject({ ok: false });
    expect(await OPS.case.list(c, { limit: 5, offset: 0 })).toMatchObject({ ok: false });
    expect((await serviceDashboard(c, NOW)) as { breaches?: unknown }).toMatchObject({
      breaches: null,
    });
  });

  it("Clinch Jobs: support requests, jobs and the schedule work; prospects, deals, quotes and orders do not", async () => {
    const b = await business("jobs");
    const c = await b.ctx();
    expect(c.subject.edition).toBe("jobs");

    const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
    must(await createCase(c, { title: "Gate sticks", customerAccountId: acct.id }));
    must(await createWorkOrder(c, { title: "Repair", serviceAccountId: acct.id }));

    expect(await createLead(c, { lastName: "Ng", companyName: "Ng Co" })).toMatchObject(FORBIDDEN);
    expect(await createOpportunity(c, { name: "Fence" })).toMatchObject(FORBIDDEN);
    expect(await createQuote(c, { name: "Fence quote" })).toMatchObject(FORBIDDEN);
    expect(await OPS.lead.list(c, { limit: 5, offset: 0 })).toMatchObject({ ok: false });
    expect(await OPS.opportunity.list(c, { limit: 5, offset: 0 })).toMatchObject({ ok: false });
    const sales = (await salesDashboard(c, NOW)) as { pipeline?: unknown; wonCents?: unknown };
    expect(sales).toMatchObject({ pipeline: null, wonCents: null });
  });

  it("Clinch Complete: everything works", async () => {
    const c = await (await business("complete")).ctx();
    must(await createLead(c, { lastName: "Ng", companyName: "Ng Co" }));
    must(await createQuote(c, { name: "Q" }));
    must(await createCase(c, { title: "Gate sticks" }));
    must(await createWorkOrder(c, { title: "Repair" }));
  });

  it("the plan limits even the owner (the System Administrator role)", async () => {
    const c = await (await business("deals")).ctx();
    expect(c.subject.privileges.lead?.create).toBe("organization");
    expect(c.subject.privileges.case).toBeUndefined();
    expect(c.subject.privileges.work_order).toBeUndefined();
    expect(c.subject.privileges.booking).toBeUndefined();
  });

  it("changing the plan takes effect on the next request, and keeps the other half's data", async () => {
    const b = await business("complete");
    let c = await b.ctx();
    const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
    const req = must(
      await createCase(c, { title: "Gate sticks", customerAccountId: acct.id }),
    ).case;

    // Full suite: the customer shows its support request.
    let groups = must(await relatedRecords(c, "account", acct.id)).groups.map((g) => g.title);
    expect(groups).toContain("Support requests");

    // Moved down to Deals: the support-request side vanishes at once, but nothing is deleted.
    await withPlatform((tx) =>
      tx.update(license).set({ edition: "deals" }).where(eq(license.id, b.licenseId)),
    );
    c = await b.ctx();
    expect(c.subject.edition).toBe("deals");
    groups = must(await relatedRecords(c, "account", acct.id)).groups.map((g) => g.title);
    expect(groups).not.toContain("Support requests");
    expect(await OPS.case.get(c, req.id)).toMatchObject({ ok: false });

    // Moved back up: it is all still there.
    await withPlatform((tx) =>
      tx.update(license).set({ edition: "complete" }).where(eq(license.id, b.licenseId)),
    );
    c = await b.ctx();
    expect(await OPS.case.get(c, req.id)).toMatchObject({ ok: true });
  });
});
