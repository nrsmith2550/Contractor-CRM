import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, resourceBooking, systemUser } from "@/db/schema";
import { seedDemo, type DemoResult } from "@/db/seed/demo";
import { buildCtx } from "@/server/domain/context";
import { listAccounts } from "@/server/domain/accounts";
import { listBookings } from "@/server/domain/bookings";
import { listCalendarEvents } from "@/server/domain/calendar";
import { listCases } from "@/server/domain/cases";
import { salesDashboard, serviceDashboard } from "@/server/domain/dashboards";
import { listLeads } from "@/server/domain/leads";
import { listOpportunities } from "@/server/domain/opportunities";
import { listOrders, listQuotes } from "@/server/domain/quotes";
import { listWorkOrders } from "@/server/domain/work-orders";
import { randomBytes } from "node:crypto";

const enabled = !!process.env.DATABASE_URL;
const PASSWORD = "violet-lantern-orbit-42";

async function seed(now = new Date("2030-05-15T15:00:00Z")): Promise<DemoResult> {
  const id = randomBytes(3).toString("hex");
  return seedDemo({
    ownerEmail: `owner@demo-${id}.example`,
    emailDomain: `demo-${id}.example`,
    password: PASSWORD,
    timeZone: "America/New_York",
    now,
  });
}
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};
const asUser = async (r: DemoResult, name: string) => {
  const [u] = await withTenant(r.tenantId, (tx) =>
    tx.select().from(systemUser).where(eq(systemUser.fullName, name)),
  );
  return buildCtx(r.tenantId, u!.id);
};

describe.skipIf(!enabled)("Demo seed", () => {
  it("builds a believable business through the real domain rules", async () => {
    // Closing a deal as won stamps the real date, so this test uses the real clock.
    const NOW = new Date();
    const r = await seed(NOW);
    expect(r.people.map((p) => p.role)).toEqual([
      "System Administrator",
      "Sales Manager",
      "Salesperson",
      "Customer Service Rep",
      "Field Technician",
      "Field Technician",
    ]);
    const owner = await buildCtx(r.tenantId, (await asUser(r, "Jordan Rivers")).userId);

    expect(must(await listAccounts(owner, { limit: 50 })).total).toBe(12);
    const leads = must(await listLeads(owner, { view: "all_open", limit: 50 }));
    expect(leads.total).toBe(12); // 14 minus the 2 disqualified
    const opps = must(await listOpportunities(owner, { view: "open", limit: 50 }));
    expect(opps.total).toBe(8);
    expect(must(await listOpportunities(owner, { view: "won", limit: 50 })).total).toBe(2);
    expect(must(await listOpportunities(owner, { view: "lost", limit: 50 })).total).toBe(1);

    // Quotes cover draft, sent and won; the won ones became orders.
    const quotes = must(await listQuotes(owner, { limit: 50 }));
    expect(quotes.rows.map((q) => q.status).sort()).toEqual(["active", "draft", "won", "won"]);
    expect(must(await listOrders(owner, { limit: 50 })).total).toBe(2);

    // Support: 8 cases; 3 resolved so 5 are active.
    expect(must(await listCases(owner, { view: "all_active", limit: 50 })).total).toBe(5);
    expect(
      must(await listWorkOrders(owner, { view: "all_open", limit: 50 })).total,
    ).toBeGreaterThanOrEqual(7);

    // The dashboards have something to show.
    const sales = must(await salesDashboard(owner, { now: NOW, tz: "America/New_York" }));
    expect(sales.pipeline!.every((s) => s.count > 0)).toBe(true); // every stage has deals
    expect(sales.wonCents).toBeGreaterThan(5_000_00);
    expect(sales.wonCount).toBe(2);
    expect(sales.leadsBySource!.length).toBeGreaterThanOrEqual(3);
    expect(sales.myActivities!.length).toBeGreaterThan(0); // the owner has tasks of their own
    const service = must(await serviceDashboard(owner, { now: NOW, tz: "America/New_York" }));
    expect(service.breachCount).toBe(1);
    expect(service.casesByPriority!.reduce((a, s) => a + s.count, 0)).toBe(5);
    expect(service.bookingsTotal).toBe(3);
  });

  it("includes a finished, signed visit with parts and labour, and upcoming bookings", async () => {
    const r = await seed();
    const owner = await asUser(r, "Jordan Rivers");
    const rows = await withTenant(r.tenantId, (tx) =>
      tx.select().from(resourceBooking).orderBy(resourceBooking.startAt),
    );
    const completed = rows.filter((b) => b.status === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ signedByName: "Mei Chen" });
    expect(rows.filter((b) => b.status === "scheduled")).toHaveLength(6);
    expect(
      must(
        await listBookings(owner, {
          from: new Date("2030-05-14T00:00:00Z"),
          to: new Date("2030-05-20T00:00:00Z"),
        }),
      ).rows,
    ).toHaveLength(7);
  });

  it("each role sees what it should, and nothing more", async () => {
    const r = await seed();
    const NOW = new Date("2030-05-15T15:00:00Z");
    const rep = await asUser(r, "Morgan Lee");
    const tech = await asUser(r, "Riley Ortiz");
    // The salesperson sees only their own leads and deals, but every account.
    const mine = must(await listLeads(rep, { view: "all_open", limit: 50 }));
    expect(mine.total).toBeGreaterThan(0);
    expect(mine.total).toBeLessThan(12);
    expect(must(await listAccounts(rep, { limit: 50 })).total).toBe(12);
    // The technician sees their own visits only, and no sales data.
    const svc = must(await serviceDashboard(tech, { now: NOW, tz: "America/New_York" }));
    expect(svc.bookingsToday).toEqual([{ key: "Riley Ortiz", label: "Riley Ortiz", count: 2 }]);
    expect(
      must(await salesDashboard(tech, { now: NOW, tz: "America/New_York" })).pipeline,
    ).toBeNull();
    // Their calendar has their own bookings in it.
    const cal = must(
      await listCalendarEvents(tech, {
        from: new Date("2030-05-15T00:00:00Z"),
        to: new Date("2030-05-18T00:00:00Z"),
      }),
    );
    expect(cal.events.some((e) => e.kind === "booking")).toBe(true);
  });

  it("makes a separate business every run and leaves others alone", async () => {
    const a = await seed();
    const before = await withTenant(a.tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.tenantId, a.tenantId)),
    );
    const b = await seed();
    expect(b.tenantId).not.toBe(a.tenantId);
    const after = await withTenant(a.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, a.tenantId))),
    );
    expect(after.length).toBe(before.length);
    const ownerB = await asUser(b, "Jordan Rivers");
    expect(must(await listAccounts(ownerB, { limit: 50 })).total).toBe(12);
  });
});
