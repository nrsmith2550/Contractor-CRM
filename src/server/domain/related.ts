import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  account,
  bookableResource,
  contact,
  incident,
  lead,
  opportunity,
  quote,
  resourceBooking,
  salesOrder,
  workOrder,
} from "@/db/schema";
import { formatMoney } from "@/lib/format";
import { tenantTimeZone } from "@/server/entities/tenant";
import { WORDS, say } from "@/lib/vocabulary";
import type { Entity } from "@/server/security/roles";
import { NOT_FOUND, checkRecord, readScope, type Ctx, type Result } from "./context";

/**
 * "Related records": every record a given record is linked to, so people can click through
 * (a customer to their jobs and orders, a job back to its support request and customer, ...).
 * Each group is limited to what the viewer may read: a link is never shown to a record they could
 * not open. Groups with nothing in them are left out.
 */

export type RelatedType =
  | "lead"
  | "account"
  | "contact"
  | "opportunity"
  | "quote"
  | "order"
  | "case"
  | "work_order"
  | "booking";
export type RelatedItem = { href: string; label: string; detail?: string };
export type RelatedGroup = { title: string; items: RelatedItem[] };

export const RELATED_TYPES: readonly RelatedType[] = [
  "lead",
  "account",
  "contact",
  "opportunity",
  "quote",
  "order",
  "case",
  "work_order",
  "booking",
];

const LIMIT = 50;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The scope condition for reading `entity`, or null when the viewer may not read it at all. */
function scoped(ctx: Ctx, entity: Entity, owner: Parameters<typeof readScope>[2], where: SQL) {
  const s = readScope(ctx.subject, entity, owner);
  return s.allowed ? and(where, s.where) : null;
}

const person = (r: { firstName: string | null; lastName: string }) =>
  [r.firstName, r.lastName].filter(Boolean).join(" ");

// One fetcher per kind of record. Each takes a condition and returns the readable matches.
const fetchers = {
  customers: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "account", account.ownerId, where);
    if (!w) return [];
    const rows = await tx.select().from(account).where(w).orderBy(asc(account.name)).limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/customers/${r.id}`,
      label: r.name,
      detail: r.accountNumber,
    }));
  },
  people: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "contact", contact.ownerId, where);
    if (!w) return [];
    const rows = await tx
      .select()
      .from(contact)
      .where(w)
      .orderBy(asc(contact.lastName))
      .limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/people/${r.id}`,
      label: person(r),
      detail: r.jobTitle ?? r.contactNumber,
    }));
  },
  prospects: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "lead", lead.ownerId, where);
    if (!w) return [];
    const rows = await tx.select().from(lead).where(w).orderBy(desc(lead.createdAt)).limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/prospects/${r.id}`,
      label: r.topic,
      detail: `${r.leadNumber} · ${say(r.status)}`,
    }));
  },
  deals: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "opportunity", opportunity.ownerId, where);
    if (!w) return [];
    const rows = await tx
      .select()
      .from(opportunity)
      .where(w)
      .orderBy(desc(opportunity.createdAt))
      .limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/deals/${r.id}`,
      label: r.name,
      detail: `${r.opportunityNumber} · ${say(r.status)} · ${formatMoney(r.estRevenueCents)}`,
    }));
  },
  quotes: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "quote", quote.ownerId, where);
    if (!w) return [];
    const rows = await tx.select().from(quote).where(w).orderBy(desc(quote.createdAt)).limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/quotes/${r.id}`,
      label: r.name,
      detail: `${r.quoteNumber} · ${say(r.status)} · ${formatMoney(r.totalCents)}`,
    }));
  },
  orders: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "order", salesOrder.ownerId, where);
    if (!w) return [];
    const rows = await tx
      .select()
      .from(salesOrder)
      .where(w)
      .orderBy(desc(salesOrder.createdAt))
      .limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/orders/${r.id}`,
      label: r.name,
      detail: `${r.orderNumber} · ${say(r.fulfillmentStatus)} · ${formatMoney(r.totalCents)}`,
    }));
  },
  requests: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "case", incident.ownerId, where);
    if (!w) return [];
    const rows = await tx
      .select()
      .from(incident)
      .where(w)
      .orderBy(desc(incident.createdAt))
      .limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/support-requests/${r.id}`,
      label: r.title,
      detail: `${r.ticketNumber} · ${say(r.status)}`,
    }));
  },
  jobs: async (tx: Tx, ctx: Ctx, where: SQL): Promise<RelatedItem[]> => {
    const w = scoped(ctx, "work_order", workOrder.ownerId, where);
    if (!w) return [];
    const rows = await tx
      .select()
      .from(workOrder)
      .where(w)
      .orderBy(desc(workOrder.createdAt))
      .limit(LIMIT);
    return rows.map((r) => ({
      href: `/app/jobs/${r.id}`,
      label: r.title,
      detail: `${r.woNumber} · ${say(r.status)}`,
    }));
  },
};

/** Visits (bookings), described by when and who. Separate because the label needs the time zone. */
async function fetchVisits(tx: Tx, ctx: Ctx, where: SQL, tz: string): Promise<RelatedItem[]> {
  const w = scoped(ctx, "booking", resourceBooking.ownerId, where);
  if (!w) return [];
  const day = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  const rows = await tx
    .select({ b: resourceBooking, who: bookableResource.name })
    .from(resourceBooking)
    .innerJoin(bookableResource, eq(bookableResource.id, resourceBooking.resourceId))
    .where(w)
    .orderBy(asc(resourceBooking.startAt))
    .limit(LIMIT);
  return rows.map(({ b, who }) => ({
    href: `/app/visits/${b.id}`,
    label: `${day.format(b.startAt)} – ${clock.format(b.endAt)}`,
    detail: `${who} · ${say(b.status)}`,
  }));
}

/** A condition that matches one specific id, or null when there is no link to follow. */
const byId = (col: Parameters<typeof eq>[0], id: string | null | undefined): SQL | null =>
  id ? eq(col, id) : null;

type Spec = [title: string, items: Promise<RelatedItem[]> | null];

export async function relatedRecords(
  ctx: Ctx,
  type: RelatedType,
  id: string,
): Promise<Result<{ groups: RelatedGroup[] }>> {
  if (!RELATED_TYPES.includes(type) || !z.string().uuid().safeParse(id).success) return NOT_FOUND;
  const tz = await tenantTimeZone(ctx.tenantId);
  return withTenant(ctx.tenantId, async (tx) => {
    const run = <K extends keyof typeof fetchers>(k: K, where: SQL | null | undefined) =>
      where ? fetchers[k](tx, ctx, where) : null;
    const runVisits = (where: SQL | null | undefined) =>
      where ? fetchVisits(tx, ctx, where, tz) : null;

    // Load the record itself (the viewer must be able to read it) and describe its links.
    let specs: Spec[] = [];
    switch (type) {
      case "account": {
        const [row] = await tx.select().from(account).where(eq(account.id, id));
        const denied = checkRecord(ctx, "account", "read", row);
        if (denied) return denied;
        // A customer's jobs: those at their own site, and those from their support requests.
        const theirJobs = or(
          eq(workOrder.serviceAccountId, id),
          inArray(
            workOrder.incidentId,
            tx.select({ id: incident.id }).from(incident).where(eq(incident.customerAccountId, id)),
          ),
        );
        specs = [
          [cap(WORDS.contact.many), run("people", eq(contact.parentAccountId, id))],
          [cap(WORDS.opportunity.many), run("deals", eq(opportunity.customerAccountId, id))],
          ["Quotes", run("quotes", eq(quote.customerAccountId, id))],
          ["Orders", run("orders", eq(salesOrder.customerAccountId, id))],
          [cap(WORDS.case.many), run("requests", eq(incident.customerAccountId, id))],
          [cap(WORDS.workOrder.many), run("jobs", theirJobs)],
          [
            cap(WORDS.booking.many),
            runVisits(
              inArray(
                resourceBooking.workOrderId,
                tx.select({ id: workOrder.id }).from(workOrder).where(theirJobs),
              ),
            ),
          ],
          [`${WORDS.lead.one} it came from`, run("prospects", eq(lead.qualifiedAccountId, id))],
          ["Part of", run("customers", byId(account.id, row!.parentAccountId))],
          ["Branches", run("customers", eq(account.parentAccountId, id))],
        ];
        break;
      }
      case "contact": {
        const [row] = await tx.select().from(contact).where(eq(contact.id, id));
        const denied = checkRecord(ctx, "contact", "read", row);
        if (denied) return denied;
        specs = [
          [WORDS.account.one, run("customers", byId(account.id, row!.parentAccountId))],
          [cap(WORDS.opportunity.many), run("deals", eq(opportunity.customerContactId, id))],
          ["Quotes", run("quotes", eq(quote.customerContactId, id))],
          ["Orders", run("orders", eq(salesOrder.customerContactId, id))],
          [cap(WORDS.case.many), run("requests", eq(incident.customerContactId, id))],
          [`${WORDS.lead.one} it came from`, run("prospects", eq(lead.qualifiedContactId, id))],
        ];
        break;
      }
      case "lead": {
        const [row] = await tx.select().from(lead).where(eq(lead.id, id));
        const denied = checkRecord(ctx, "lead", "read", row);
        if (denied) return denied;
        specs = [
          [WORDS.account.one, run("customers", byId(account.id, row!.qualifiedAccountId))],
          [WORDS.contact.one, run("people", byId(contact.id, row!.qualifiedContactId))],
          [WORDS.opportunity.one, run("deals", byId(opportunity.id, row!.qualifiedOpportunityId))],
        ];
        break;
      }
      case "opportunity": {
        const [row] = await tx.select().from(opportunity).where(eq(opportunity.id, id));
        const denied = checkRecord(ctx, "opportunity", "read", row);
        if (denied) return denied;
        specs = [
          [WORDS.account.one, run("customers", byId(account.id, row!.customerAccountId))],
          [WORDS.contact.one, run("people", byId(contact.id, row!.customerContactId))],
          [WORDS.lead.one, run("prospects", byId(lead.id, row!.originatingLeadId))],
          ["Quotes", run("quotes", eq(quote.opportunityId, id))],
          ["Orders", run("orders", eq(salesOrder.opportunityId, id))],
        ];
        break;
      }
      case "quote": {
        const [row] = await tx.select().from(quote).where(eq(quote.id, id));
        const denied = checkRecord(ctx, "quote", "read", row);
        if (denied) return denied;
        specs = [
          [WORDS.account.one, run("customers", byId(account.id, row!.customerAccountId))],
          [WORDS.contact.one, run("people", byId(contact.id, row!.customerContactId))],
          [WORDS.opportunity.one, run("deals", byId(opportunity.id, row!.opportunityId))],
          ["Orders", run("orders", eq(salesOrder.quoteId, id))],
          ["Other versions of this quote", run("quotes", eq(quote.baseNumber, row!.baseNumber))],
        ];
        break;
      }
      case "order": {
        const [row] = await tx.select().from(salesOrder).where(eq(salesOrder.id, id));
        const denied = checkRecord(ctx, "order", "read", row);
        if (denied) return denied;
        specs = [
          [WORDS.account.one, run("customers", byId(account.id, row!.customerAccountId))],
          [WORDS.contact.one, run("people", byId(contact.id, row!.customerContactId))],
          [WORDS.opportunity.one, run("deals", byId(opportunity.id, row!.opportunityId))],
          ["Quote", run("quotes", byId(quote.id, row!.quoteId))],
        ];
        break;
      }
      case "case": {
        const [row] = await tx.select().from(incident).where(eq(incident.id, id));
        const denied = checkRecord(ctx, "case", "read", row);
        if (denied) return denied;
        specs = [
          [WORDS.account.one, run("customers", byId(account.id, row!.customerAccountId))],
          [WORDS.contact.one, run("people", byId(contact.id, row!.customerContactId))],
          [cap(WORDS.workOrder.many), run("jobs", eq(workOrder.incidentId, id))],
        ];
        break;
      }
      case "booking": {
        const [row] = await tx.select().from(resourceBooking).where(eq(resourceBooking.id, id));
        const denied = checkRecord(ctx, "booking", "read", row);
        if (denied) return denied;
        const [job] = row!.workOrderId
          ? await tx.select().from(workOrder).where(eq(workOrder.id, row!.workOrderId))
          : [];
        const [req] = job?.incidentId
          ? await tx.select().from(incident).where(eq(incident.id, job.incidentId))
          : [];
        const customerId = job?.serviceAccountId ?? req?.customerAccountId ?? null;
        specs = [
          [WORDS.workOrder.one, run("jobs", byId(workOrder.id, row!.workOrderId))],
          [WORDS.case.one, run("requests", byId(incident.id, job?.incidentId))],
          [WORDS.account.one, run("customers", byId(account.id, customerId))],
          [WORDS.contact.one, run("people", byId(contact.id, req?.customerContactId))],
          [
            "Other visits for this job",
            runVisits(byId(resourceBooking.workOrderId, row!.workOrderId)),
          ],
        ];
        break;
      }
      case "work_order": {
        const [row] = await tx.select().from(workOrder).where(eq(workOrder.id, id));
        const denied = checkRecord(ctx, "work_order", "read", row);
        if (denied) return denied;
        // The customer is the job's own site, or else the customer on its support request.
        const [req] = row!.incidentId
          ? await tx.select().from(incident).where(eq(incident.id, row!.incidentId))
          : [];
        const customerId = row!.serviceAccountId ?? req?.customerAccountId ?? null;
        specs = [
          [WORDS.case.one, run("requests", byId(incident.id, row!.incidentId))],
          [cap(WORDS.booking.many), runVisits(eq(resourceBooking.workOrderId, id))],
          [WORDS.account.one, run("customers", byId(account.id, customerId))],
          [WORDS.contact.one, run("people", byId(contact.id, req?.customerContactId))],
        ];
        break;
      }
    }

    const groups: RelatedGroup[] = [];
    for (const [title, pending] of specs) {
      // Never list the record itself (e.g. the other versions of a quote include this one).
      const items = pending ? (await pending).filter((i) => !i.href.endsWith(`/${id}`)) : [];
      if (items.length > 0) groups.push({ title, items });
    }
    return { ok: true, groups };
  });
}
