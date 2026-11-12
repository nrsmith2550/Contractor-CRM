import { and, count, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { account, contact, lead, opportunity } from "@/db/schema";
import { can, type Entity } from "@/server/security/roles";
import { diffChanges, recordAudit } from "./audit";
import {
  FORBIDDEN,
  NOT_FOUND,
  checkRecord,
  fail,
  readScope,
  type Ctx,
  type Fail,
  type Result,
} from "./context";
import { findDuplicates } from "./duplicates";
import { nextNumber } from "./numbering";

export type Lead = typeof lead.$inferSelect;

export const LEAD_SOURCES = ["web", "phone", "referral", "trade_show", "email", "other"] as const;
export const LEAD_RATINGS = ["hot", "warm", "cold"] as const;
export const DISQUALIFY_REASONS = [
  "lost",
  "cannot_contact",
  "no_longer_interested",
  "cancelled",
] as const;

/** "" and null both mean "no value" (null clears a field on update; undefined leaves it alone). */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
export const text = (max = 200) =>
  z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional());
const enumOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(blankToNull, z.enum(values).nullable().optional());

export const addressFields = {
  addressStreet: text(),
  addressCity: text(120),
  addressRegion: text(120),
  addressPostalCode: text(20),
  addressCountry: text(120),
};

export const leadFields = z.object({
  topic: text(),
  firstName: text(120),
  lastName: z.string().trim().min(1, "Last name is required").max(120),
  jobTitle: text(),
  companyName: text(),
  email: z.preprocess(
    blankToNull,
    z.string().trim().toLowerCase().email("Enter a valid email").max(254).nullable().optional(),
  ),
  phone: text(40),
  leadSource: enumOf(LEAD_SOURCES),
  rating: enumOf(LEAD_RATINGS),
  estValueCents: z.number().int().min(0).max(1e12).nullable().optional(),
  ...addressFields,
});

export const invalid = (p: { error: z.ZodError }): Fail =>
  fail("invalid", p.error.issues[0]?.message ?? "Check the form.", {
    issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export const LEAD_VIEWS = [
  { id: "my_open", label: "My Open Leads" },
  { id: "all_open", label: "All Open Leads" },
  { id: "this_week", label: "Leads Opened This Week" },
  { id: "disqualified", label: "Disqualified Leads" },
] as const;
export type LeadView = (typeof LEAD_VIEWS)[number]["id"];

export async function createLead(ctx: Ctx, raw: unknown): Promise<Result<{ lead: Lead }>> {
  if (!can(ctx.subject, "lead", "create")) return FORBIDDEN;
  const p = leadFields.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  const topic =
    d.topic ??
    (d.companyName
      ? `${d.companyName} — ${d.lastName}`
      : [d.firstName, d.lastName].filter(Boolean).join(" "));

  return withTenant(ctx.tenantId, async (tx) => {
    const leadNumber = await nextNumber(tx, ctx.tenantId, "lead");
    const [row] = await tx
      .insert(lead)
      .values({
        ...d,
        topic,
        leadNumber,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "lead",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true, lead: row! };
  });
}

export async function getLead(ctx: Ctx, id: string): Promise<Result<{ lead: Lead }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(lead).where(eq(lead.id, id));
    return checkRecord(ctx, "lead", "read", row) ?? { ok: true, lead: row! };
  });
}

export async function listLeads(
  ctx: Ctx,
  opts: { view?: LeadView; search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Lead[]; total: number }>> {
  const scope = readScope(ctx.subject, "lead", lead.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const view = opts.view ?? "my_open";
  const open = inArray(lead.status, ["new", "contacted"]);
  const byView: Record<LeadView, SQL | undefined> = {
    my_open: and(open, eq(lead.ownerId, ctx.userId)),
    all_open: open,
    this_week: gte(lead.createdAt, sql`now() - interval '7 days'`),
    disqualified: eq(lead.status, "disqualified"),
  };
  const q = opts.search?.trim();
  const where = and(
    scope.where,
    byView[view],
    q
      ? or(
          ilike(lead.topic, `%${q}%`),
          ilike(lead.lastName, `%${q}%`),
          ilike(lead.companyName, `%${q}%`),
          ilike(lead.email, `%${q}%`),
          ilike(lead.leadNumber, `%${q}%`),
        )
      : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(lead)
      .where(where)
      .orderBy(desc(lead.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(lead).where(where);
    return { ok: true, rows, total: total!.n };
  });
}

/** Loads a lead for a change: visible, permitted, and still editable (not qualified/disqualified). */
async function loadEditable(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  ctx: Ctx,
  id: string,
) {
  const [row] = await tx.select().from(lead).where(eq(lead.id, id)).for("update");
  const denied = checkRecord(ctx, "lead", "write", row);
  if (denied) return { denied };
  return { row: row! };
}

export async function updateLead(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ lead: Lead }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = leadFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadEditable(tx, ctx, id);
    if (denied) return denied;
    if (row.status === "qualified" || row.status === "disqualified") {
      return fail("read_only", `This lead is ${row.status} and can't be edited.`);
    }
    const patch = defined(p.data);
    // The topic is required: it can be changed but not cleared.
    if (patch.topic === null) return fail("invalid", "Topic can't be empty.");
    const changes = diffChanges(row as never, { ...row, ...patch } as never, Object.keys(patch));
    if (Object.keys(changes).length === 0) return { ok: true, lead: row };
    const [updated] = await tx
      .update(lead)
      .set({
        ...patch,
        topic: patch.topic ?? undefined,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(lead.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "lead",
      recordId: id,
      action: "update",
      changes,
    });
    return { ok: true, lead: updated! };
  });
}

export async function markLeadContacted(ctx: Ctx, id: string): Promise<Result<{ lead: Lead }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadEditable(tx, ctx, id);
    if (denied) return denied;
    if (row.status !== "new")
      return fail("conflict", "Only a new lead can be marked as contacted.");
    const [updated] = await tx
      .update(lead)
      .set({ status: "contacted", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(lead.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "lead",
      recordId: id,
      action: "status",
      changes: { status: { from: "new", to: "contacted" } },
    });
    return { ok: true, lead: updated! };
  });
}

export async function disqualifyLead(
  ctx: Ctx,
  id: string,
  reason: unknown,
): Promise<Result<{ lead: Lead }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const r = z.enum(DISQUALIFY_REASONS).safeParse(reason);
  if (!r.success) return fail("invalid", "Choose a reason for disqualifying this lead.");
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadEditable(tx, ctx, id);
    if (denied) return denied;
    if (row.status === "qualified")
      return fail("read_only", "A qualified lead can't be disqualified.");
    if (row.status === "disqualified")
      return fail("conflict", "This lead is already disqualified.");
    const [updated] = await tx
      .update(lead)
      .set({
        status: "disqualified",
        disqualifyReason: r.data,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(lead.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "lead",
      recordId: id,
      action: "disqualify",
      changes: { status: { from: row.status, to: "disqualified" }, reason: r.data },
    });
    return { ok: true, lead: updated! };
  });
}

export async function reactivateLead(ctx: Ctx, id: string): Promise<Result<{ lead: Lead }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadEditable(tx, ctx, id);
    if (denied) return denied;
    if (row.status !== "disqualified")
      return fail("conflict", "Only a disqualified lead can be reactivated.");
    const [updated] = await tx
      .update(lead)
      .set({
        status: "new",
        disqualifyReason: null,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(lead.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "lead",
      recordId: id,
      action: "reactivate",
    });
    return { ok: true, lead: updated! };
  });
}

const choice = z.union([z.literal("new"), z.string().uuid()]).optional();
export const qualifyOptions = z.object({
  /** "new" creates an account; an id reuses one; omitted lets duplicate detection decide. */
  account: choice,
  contact: choice,
  createOpportunity: z.boolean().default(true),
  opportunityName: text().optional(),
});

/**
 * Qualify: creates (or reuses) the Account and Contact and, optionally, an Opportunity, links them
 * to the lead, and makes the lead read-only with status Qualified. If matching accounts or contacts
 * already exist and the caller hasn't said what to do, nothing is created and the matches come back
 * so the user can choose between reusing one and creating a new record.
 */
export async function qualifyLead(
  ctx: Ctx,
  id: string,
  rawOptions: unknown = {},
): Promise<Result<{ accountId: string; contactId: string; opportunityId: string | null }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const o = qualifyOptions.safeParse(rawOptions ?? {});
  if (!o.success) return invalid(o);
  const opts = o.data;

  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadEditable(tx, ctx, id);
    if (denied) return denied;
    if (row.status === "qualified") return fail("read_only", "This lead is already qualified.");
    if (row.status === "disqualified")
      return fail("read_only", "Reactivate the lead before qualifying it.");
    // Qualifying creates records, so the user needs "create" on each of them.
    const needed: Entity[] = ["account", "contact"];
    if (opts.createOpportunity) needed.push("opportunity");
    if (needed.some((entity) => !can(ctx.subject, entity, "create"))) return FORBIDDEN;

    if (opts.account === undefined && opts.contact === undefined) {
      const duplicates = await findDuplicates(tx, {
        email: row.email,
        phone: row.phone,
        companyName: row.companyName,
      });
      if (duplicates.length > 0) {
        return fail(
          "duplicates",
          "Matching records already exist. Reuse one or create a new record.",
          { duplicates },
        );
      }
    }

    const audit = (
      entity: string,
      recordId: string,
      action: string,
      changes?: Record<string, unknown>,
    ) =>
      recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity,
        recordId,
        action,
        changes,
      });
    const common = {
      tenantId: ctx.tenantId,
      ownerId: row.ownerId,
      createdBy: ctx.userId,
      modifiedBy: ctx.userId,
    };
    const address = {
      addressStreet: row.addressStreet,
      addressCity: row.addressCity,
      addressRegion: row.addressRegion,
      addressPostalCode: row.addressPostalCode,
      addressCountry: row.addressCountry,
    };

    // Account
    let accountId: string;
    if (opts.account && opts.account !== "new") {
      const [a] = await tx
        .select({ id: account.id })
        .from(account)
        .where(eq(account.id, opts.account));
      if (!a) return fail("invalid", "The account you chose no longer exists.");
      accountId = a.id;
    } else {
      const [a] = await tx
        .insert(account)
        .values({
          ...common,
          ...address,
          accountNumber: await nextNumber(tx, ctx.tenantId, "account"),
          name: row.companyName ?? [row.firstName, row.lastName].filter(Boolean).join(" "),
          phone: row.phone,
          relationshipType: "prospect",
        })
        .returning({ id: account.id });
      accountId = a!.id;
      await audit("account", accountId, "create", { source: `lead ${row.leadNumber}` });
    }

    // Contact
    let contactId: string;
    if (opts.contact && opts.contact !== "new") {
      const [c] = await tx
        .select({ id: contact.id })
        .from(contact)
        .where(eq(contact.id, opts.contact));
      if (!c) return fail("invalid", "The contact you chose no longer exists.");
      contactId = c.id;
    } else {
      const [c] = await tx
        .insert(contact)
        .values({
          ...common,
          ...address,
          contactNumber: await nextNumber(tx, ctx.tenantId, "contact"),
          firstName: row.firstName,
          lastName: row.lastName,
          jobTitle: row.jobTitle,
          email: row.email,
          businessPhone: row.phone,
          parentAccountId: accountId,
        })
        .returning({ id: contact.id });
      contactId = c!.id;
      await audit("contact", contactId, "create", { source: `lead ${row.leadNumber}` });
      await tx
        .update(account)
        .set({ primaryContactId: contactId })
        .where(and(eq(account.id, accountId), sql`${account.primaryContactId} is null`));
    }

    // Opportunity
    let opportunityId: string | null = null;
    if (opts.createOpportunity) {
      const [op] = await tx
        .insert(opportunity)
        .values({
          ...common,
          opportunityNumber: await nextNumber(tx, ctx.tenantId, "opportunity"),
          name: opts.opportunityName ?? row.topic,
          customerAccountId: accountId,
          customerContactId: contactId,
          originatingLeadId: row.id,
          estRevenueCents: row.estValueCents ?? 0,
        })
        .returning({ id: opportunity.id });
      opportunityId = op!.id;
      await audit("opportunity", opportunityId, "create", { source: `lead ${row.leadNumber}` });
    }

    await tx
      .update(lead)
      .set({
        status: "qualified",
        qualifiedAccountId: accountId,
        qualifiedContactId: contactId,
        qualifiedOpportunityId: opportunityId,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(lead.id, id));
    await audit("lead", id, "qualify", {
      status: { from: row.status, to: "qualified" },
      accountId,
      contactId,
      opportunityId,
    });
    return { ok: true, accountId, contactId, opportunityId };
  });
}
