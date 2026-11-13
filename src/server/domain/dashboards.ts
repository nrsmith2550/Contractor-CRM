import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, ne, sql, sum } from "drizzle-orm";
import { withTenant } from "@/db/client";
import {
  activity,
  bookableResource,
  incident,
  lead,
  opportunity,
  resourceBooking,
} from "@/db/schema";
import { dayRange, quarterRange } from "@/lib/dashboard";
import { recordHref } from "@/lib/calendar";
import { readScope, type Ctx, type Result } from "./context";

// Numbers for the Sales and Service dashboards. Every query is limited by the same read scope as
// the lists, so a user-level role sees dashboards of only their own records. A section the user may
// not read at all comes back as null.

type Opts = { now: Date; tz: string };
export type Slice = { key: string; label: string; count: number; cents?: number };

const STAGES = ["qualify", "develop", "propose", "close"] as const;
const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
const ACTIVE_CASE = ["in_progress", "on_hold", "waiting_on_customer"] as const;
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export type SalesDashboard = {
  quarter: string;
  pipeline: Slice[] | null;
  wonCents: number | null;
  wonCount: number | null;
  leadsBySource: Slice[] | null;
  myActivities:
    { id: string; subject: string; type: string; when: Date | null; href: string | null }[] | null;
};

export async function salesDashboard(ctx: Ctx, o: Opts): Promise<Result<SalesDashboard>> {
  const q = quarterRange(o.now, o.tz);
  const opp = readScope(ctx.subject, "opportunity", opportunity.ownerId);
  const ld = readScope(ctx.subject, "lead", lead.ownerId);
  const act = readScope(ctx.subject, "activity", activity.ownerId);

  const dashboard = await withTenant(ctx.tenantId, async (tx) => {
    let pipeline: Slice[] | null = null;
    let wonCents: number | null = null;
    let wonCount: number | null = null;
    if (opp.allowed) {
      const rows = await tx
        .select({
          stage: opportunity.stage,
          n: count(),
          total: sum(opportunity.estRevenueCents),
        })
        .from(opportunity)
        .where(and(opp.where, eq(opportunity.status, "open")))
        .groupBy(opportunity.stage);
      pipeline = STAGES.map((s) => {
        const r = rows.find((x) => x.stage === s);
        return { key: s, label: label(s), count: r?.n ?? 0, cents: Number(r?.total ?? 0) };
      });
      const [won] = await tx
        .select({ n: count(), total: sum(opportunity.actualRevenueCents) })
        .from(opportunity)
        .where(
          and(
            opp.where,
            eq(opportunity.status, "won"),
            gte(opportunity.actualCloseDate, q.startDate),
            lt(opportunity.actualCloseDate, q.endDate),
          ),
        );
      wonCents = Number(won?.total ?? 0);
      wonCount = won?.n ?? 0;
    }

    let leadsBySource: Slice[] | null = null;
    if (ld.allowed) {
      const rows = await tx
        .select({ source: sql<string>`coalesce(${lead.leadSource}, '')`, n: count() })
        .from(lead)
        .where(and(ld.where, inArray(lead.status, ["new", "contacted"])))
        .groupBy(sql`coalesce(${lead.leadSource}, '')`)
        .orderBy(desc(count()), sql`coalesce(${lead.leadSource}, '') asc`);
      leadsBySource = rows.map((r) => ({
        key: r.source || "unknown",
        label: r.source ? label(r.source) : "No source",
        count: r.n,
      }));
    }

    let myActivities: SalesDashboard["myActivities"] = null;
    if (act.allowed) {
      const rows = await tx
        .select()
        .from(activity)
        .where(and(eq(activity.ownerId, ctx.userId), eq(activity.status, "open")))
        .orderBy(
          sql`coalesce(${activity.dueAt}, ${activity.scheduledStart}) asc nulls last`,
          asc(activity.createdAt),
        )
        .limit(8);
      myActivities = rows.map((a) => ({
        id: a.id,
        subject: a.subject,
        type: label(a.activityType),
        when: a.dueAt ?? a.scheduledStart ?? null,
        href: a.regardingType && a.regardingId ? recordHref(a.regardingType, a.regardingId) : null,
      }));
    }
    return { quarter: q.label, pipeline, wonCents, wonCount, leadsBySource, myActivities };
  });
  return { ok: true, ...dashboard };
}

export type ServiceDashboard = {
  casesByPriority: Slice[] | null;
  breaches:
    { id: string; ticketNumber: string; title: string; priority: string; dueAt: Date }[] | null;
  breachCount: number | null;
  bookingsToday: Slice[] | null;
  bookingsTotal: number | null;
};

export async function serviceDashboard(ctx: Ctx, o: Opts): Promise<Result<ServiceDashboard>> {
  const day = dayRange(o.now, o.tz);
  const cs = readScope(ctx.subject, "case", incident.ownerId);
  const bk = readScope(ctx.subject, "booking", resourceBooking.ownerId);

  const out = await withTenant(ctx.tenantId, async (tx) => {
    let casesByPriority: Slice[] | null = null;
    let breaches: ServiceDashboard["breaches"] = null;
    let breachCount: number | null = null;
    if (cs.allowed) {
      const rows = await tx
        .select({ priority: incident.priority, n: count() })
        .from(incident)
        .where(and(cs.where, inArray(incident.status, [...ACTIVE_CASE])))
        .groupBy(incident.priority);
      casesByPriority = PRIORITIES.map((p) => ({
        key: p,
        label: label(p),
        count: rows.find((r) => r.priority === p)?.n ?? 0,
      }));
      const late = and(
        cs.where,
        inArray(incident.status, [...ACTIVE_CASE]),
        isNotNull(incident.slaDueAt),
        lt(incident.slaDueAt, o.now),
      );
      const [c] = await tx.select({ n: count() }).from(incident).where(late);
      breachCount = c?.n ?? 0;
      const rows2 = await tx
        .select()
        .from(incident)
        .where(late)
        .orderBy(asc(incident.slaDueAt))
        .limit(8);
      breaches = rows2.map((r) => ({
        id: r.id,
        ticketNumber: r.ticketNumber,
        title: r.title,
        priority: r.priority,
        dueAt: r.slaDueAt!,
      }));
    }

    let bookingsToday: Slice[] | null = null;
    let bookingsTotal: number | null = null;
    if (bk.allowed) {
      const rows = await tx
        .select({ name: bookableResource.name, n: count() })
        .from(resourceBooking)
        .innerJoin(bookableResource, eq(bookableResource.id, resourceBooking.resourceId))
        .where(
          and(
            bk.where,
            ne(resourceBooking.status, "cancelled"),
            lt(resourceBooking.startAt, day.end),
            sql`${resourceBooking.endAt} > ${day.start}`,
          ),
        )
        .groupBy(bookableResource.id, bookableResource.name)
        .orderBy(asc(bookableResource.name));
      bookingsToday = rows.map((r) => ({ key: r.name, label: r.name, count: r.n }));
      bookingsTotal = rows.reduce((a, r) => a + r.n, 0);
    }
    return { casesByPriority, breaches, breachCount, bookingsToday, bookingsTotal };
  });
  return { ok: true, ...out };
}
