import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  account,
  opportunity,
  opportunityProduct,
  product,
  quote,
  quoteDetail,
  salesOrder,
  salesOrderDetail,
  taxRate,
} from "@/db/schema";
import { can } from "@/server/security/roles";
import { recordAudit } from "./audit";
import { unitPriceFor } from "./catalog";
import {
  FORBIDDEN,
  NOT_FOUND,
  checkRecord,
  fail,
  readScope,
  type Ctx,
  type Result,
} from "./context";
import { invalid, text } from "./leads";
import { nextNumber } from "./numbering";
import { calculateQuote } from "./quote-math";

// Quote lifecycle: Draft -> Active (read-only, can be sent) -> Won | Lost, or Revised when a
// new draft revision (QUO-00001-R1) replaces it. All totals are recomputed on the server from
// the lines with integer-cent math (quote-math.ts); nothing the client sends is trusted for money
// beyond unit price and discount, which the user may set.

export type Quote = typeof quote.$inferSelect;
export type QuoteLine = typeof quoteDetail.$inferSelect;
export type SalesOrder = typeof salesOrder.$inferSelect;

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const uuidOrNull = z.string().uuid().nullable().optional();
const money = z.number().int().min(0).max(1e12);

export const quoteFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  opportunityId: uuidOrNull,
  customerAccountId: uuidOrNull,
  customerContactId: uuidOrNull,
  priceListId: uuidOrNull,
  paymentTerms: text(200),
  termsText: text(4000),
  freightCents: money.optional(),
  // A percent (in basis points) or a fixed amount, never both. null clears.
  discountPercentBp: z.number().int().min(0).max(10_000).nullable().optional(),
  discountAmountCents: money.nullable().optional(),
});

export const lineFields = z.object({
  productId: uuidOrNull,
  description: z.string().trim().max(300).optional(),
  quantity: z.number().min(0).max(1_000_000),
  unitPriceCents: money.optional(), // defaults from the price list for catalog products
  discountCents: money.optional(),
  taxRateBp: z.number().int().min(0).max(100_000).optional(), // defaults from the product's tax rate
});

type Lines = QuoteLine[];

const omit = <T extends object, K extends keyof T>(o: T, keys: K[]): Omit<T, K> => {
  const out = { ...o };
  for (const k of keys) delete out[k];
  return out;
};

/** Recomputes every line and the header totals from the lines. Call after any change to either. */
async function recalc(tx: Tx, id: string): Promise<Quote> {
  const [q] = await tx.select().from(quote).where(eq(quote.id, id));
  const lines = await tx
    .select()
    .from(quoteDetail)
    .where(eq(quoteDetail.quoteId, id))
    .orderBy(asc(quoteDetail.lineNumber));
  const discount =
    q!.discountPercentBp != null
      ? ({ kind: "percent", bp: q!.discountPercentBp } as const)
      : q!.discountAmountCents != null
        ? ({ kind: "amount", cents: q!.discountAmountCents } as const)
        : ({ kind: "none" } as const);
  const t = calculateQuote(
    lines.map((l) => ({
      quantity: l.quantityMilli / 1000,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      taxRateBp: l.taxRateBp,
    })),
    { discount, freightCents: q!.freightCents },
  );
  for (const [i, l] of lines.entries()) {
    if (l.extendedCents !== t.lines[i]!.extendedCents) {
      await tx
        .update(quoteDetail)
        .set({ extendedCents: t.lines[i]!.extendedCents })
        .where(eq(quoteDetail.id, l.id));
    }
  }
  const [updated] = await tx
    .update(quote)
    .set({
      subtotalCents: t.subtotalCents,
      discountCents: t.discountCents,
      taxCents: t.taxCents,
      totalCents: t.totalCents,
      modifiedAt: new Date(),
    })
    .where(eq(quote.id, id))
    .returning();
  return updated!;
}

async function load(tx: Tx, ctx: Ctx, id: string, action: "read" | "write") {
  const [row] = await tx
    .select()
    .from(quote)
    .where(eq(quote.id, id))
    .for(action === "write" ? "update" : "share");
  const denied = checkRecord(ctx, "quote", action, row);
  return denied ? { denied } : { row: row! };
}

const draftOnly = (q: Quote) =>
  q.status === "draft"
    ? null
    : fail(
        "read_only",
        `This quote is ${q.status}. Only draft quotes can be edited; revise it to make changes.`,
      );

/** Validates that a referenced opportunity/account is visible to the user (RLS fences tenants). */
async function checkLinks(
  tx: Tx,
  ctx: Ctx,
  d: { opportunityId?: string | null; customerAccountId?: string | null },
) {
  if (d.opportunityId) {
    const [o] = await tx.select().from(opportunity).where(eq(opportunity.id, d.opportunityId));
    if (checkRecord(ctx, "opportunity", "read", o))
      return fail("invalid", "That deal doesn't exist or you don't have access to it.");
  }
  if (d.customerAccountId) {
    const [a] = await tx.select().from(account).where(eq(account.id, d.customerAccountId));
    if (checkRecord(ctx, "account", "read", a))
      return fail("invalid", "That customer doesn't exist or you don't have access to it.");
  }
  return null;
}

const noBoth = (d: { discountPercentBp?: number | null; discountAmountCents?: number | null }) =>
  d.discountPercentBp != null && d.discountAmountCents != null
    ? fail("invalid", "Use a discount percent or a discount amount, not both.")
    : null;

export async function createQuote(ctx: Ctx, raw: unknown): Promise<Result<{ quote: Quote }>> {
  if (!can(ctx.subject, "quote", "create")) return FORBIDDEN;
  const p = quoteFields.safeParse(raw);
  if (!p.success) return invalid(p);
  const both = noBoth(p.data);
  if (both) return both;
  return withTenant(ctx.tenantId, async (tx) => {
    const bad = await checkLinks(tx, ctx, p.data);
    if (bad) return bad;
    let accountId = p.data.customerAccountId ?? null;
    let contactId = p.data.customerContactId ?? null;
    if (p.data.opportunityId) {
      const [o] = await tx
        .select()
        .from(opportunity)
        .where(eq(opportunity.id, p.data.opportunityId));
      accountId ??= o!.customerAccountId;
      contactId ??= o!.customerContactId;
    }
    const base = await nextNumber(tx, ctx.tenantId, "quote");
    const [row] = await tx
      .insert(quote)
      .values({
        ...p.data,
        customerAccountId: accountId,
        customerContactId: contactId,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        quoteNumber: base,
        baseNumber: base,
      })
      .returning();
    // A quote started from an opportunity starts with that opportunity's product lines.
    if (p.data.opportunityId) {
      const oppLines = await tx
        .select({ l: opportunityProduct, rate: taxRate.rateBp })
        .from(opportunityProduct)
        .leftJoin(product, eq(product.id, opportunityProduct.productId))
        .leftJoin(taxRate, eq(taxRate.id, product.taxRateId))
        .where(eq(opportunityProduct.opportunityId, p.data.opportunityId))
        .orderBy(asc(opportunityProduct.lineNumber));
      if (oppLines.length > 0) {
        await tx.insert(quoteDetail).values(
          oppLines.map(({ l, rate }) => ({
            tenantId: ctx.tenantId,
            quoteId: row!.id,
            lineNumber: l.lineNumber,
            productId: l.productId,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unitPriceCents: l.unitPriceCents,
            discountCents: l.discountCents,
            taxRateBp: rate ?? 0,
          })),
        );
      }
    }
    const q = await recalc(tx, row!.id);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: q.id,
      action: "create",
    });
    return { ok: true as const, quote: q };
  });
}

export async function getQuote(
  ctx: Ctx,
  id: string,
): Promise<Result<{ quote: Quote; lines: Lines }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id, "read");
    if (denied) return denied;
    const lines = await tx
      .select()
      .from(quoteDetail)
      .where(eq(quoteDetail.quoteId, id))
      .orderBy(asc(quoteDetail.lineNumber));
    return { ok: true as const, quote: row, lines };
  });
}

export async function listQuotes(
  ctx: Ctx,
  opts: { opportunityId?: string; search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Quote[]; total: number }>> {
  const scope = readScope(ctx.subject, "quote", quote.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const q = opts.search?.trim();
  const where = and(
    scope.where,
    opts.opportunityId ? eq(quote.opportunityId, opts.opportunityId) : undefined,
    q ? ilike(quote.name, `%${q}%`) : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(quote)
      .where(where)
      .orderBy(desc(quote.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(quote).where(where);
    return { ok: true as const, rows, total: total!.n };
  });
}

export async function updateQuote(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ quote: Quote }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = quoteFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  const both = noBoth(p.data);
  if (both) return both;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id, "write");
    if (denied) return denied;
    const ro = draftOnly(row);
    if (ro) return ro;
    const bad = await checkLinks(tx, ctx, p.data);
    if (bad) return bad;
    const patch = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined));
    // Setting one kind of discount clears the other.
    if (patch.discountPercentBp != null) patch.discountAmountCents = null;
    if (patch.discountAmountCents != null) patch.discountPercentBp = null;
    await tx
      .update(quote)
      .set({ ...patch, modifiedBy: ctx.userId })
      .where(eq(quote.id, id));
    const q = await recalc(tx, id);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: id,
      action: "update",
      changes: patch,
    });
    return { ok: true as const, quote: q };
  });
}

export async function addLine(
  ctx: Ctx,
  quoteId: string,
  raw: unknown,
): Promise<Result<{ quote: Quote; line: QuoteLine }>> {
  if (!isUuid(quoteId)) return NOT_FOUND;
  const p = lineFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, quoteId, "write");
    if (denied) return denied;
    const ro = draftOnly(row);
    if (ro) return ro;

    let description = p.data.description?.trim() ?? "";
    let unitPrice = p.data.unitPriceCents;
    let taxRateBp = p.data.taxRateBp;
    if (p.data.productId) {
      const [pr] = await tx.select().from(product).where(eq(product.id, p.data.productId));
      if (!pr) return fail("invalid", "That product or service doesn't exist.");
      description ||= pr.name;
      unitPrice ??= (await unitPriceFor(tx, pr.id, row.priceListId)) ?? 0;
      if (taxRateBp === undefined && pr.taxRateId) {
        const [tr] = await tx.select().from(taxRate).where(eq(taxRate.id, pr.taxRateId));
        taxRateBp = tr?.rateBp;
      }
    }
    if (!description) return fail("invalid", "Enter a description for a write-in line.");
    if (unitPrice === undefined) return fail("invalid", "Enter a unit price.");

    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${quoteDetail.lineNumber}), 0)` })
      .from(quoteDetail)
      .where(eq(quoteDetail.quoteId, quoteId));
    const [line] = await tx
      .insert(quoteDetail)
      .values({
        tenantId: ctx.tenantId,
        quoteId,
        lineNumber: Number(last!.n) + 1,
        productId: p.data.productId ?? null,
        description,
        quantityMilli: Math.round(p.data.quantity * 1000),
        unitPriceCents: unitPrice,
        discountCents: p.data.discountCents ?? 0,
        taxRateBp: taxRateBp ?? 0,
      })
      .returning();
    const q = await recalc(tx, quoteId);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: quoteId,
      action: "add_line",
      changes: { line: line!.lineNumber },
    });
    const [fresh] = await tx.select().from(quoteDetail).where(eq(quoteDetail.id, line!.id));
    return { ok: true as const, quote: q, line: fresh! };
  });
}

export async function removeLine(
  ctx: Ctx,
  quoteId: string,
  lineId: string,
): Promise<Result<{ quote: Quote }>> {
  if (!isUuid(quoteId) || !isUuid(lineId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, quoteId, "write");
    if (denied) return denied;
    const ro = draftOnly(row);
    if (ro) return ro;
    const gone = await tx
      .delete(quoteDetail)
      .where(and(eq(quoteDetail.id, lineId), eq(quoteDetail.quoteId, quoteId)))
      .returning({ id: quoteDetail.id });
    if (gone.length === 0) return NOT_FOUND;
    // Keep line numbers contiguous.
    const rest = await tx
      .select({ id: quoteDetail.id })
      .from(quoteDetail)
      .where(eq(quoteDetail.quoteId, quoteId))
      .orderBy(asc(quoteDetail.lineNumber));
    for (const [i, r] of rest.entries())
      await tx
        .update(quoteDetail)
        .set({ lineNumber: -(i + 1) })
        .where(eq(quoteDetail.id, r.id));
    for (const [i, r] of rest.entries())
      await tx
        .update(quoteDetail)
        .set({ lineNumber: i + 1 })
        .where(eq(quoteDetail.id, r.id));
    const q = await recalc(tx, quoteId);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: quoteId,
      action: "remove_line",
    });
    return { ok: true as const, quote: q };
  });
}

/** Locks the quote so it can be sent. It needs at least one line. */
export async function activateQuote(ctx: Ctx, id: string): Promise<Result<{ quote: Quote }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id, "write");
    if (denied) return denied;
    if (row.status !== "draft") return fail("read_only", `This quote is already ${row.status}.`);
    const [n] = await tx
      .select({ n: count() })
      .from(quoteDetail)
      .where(eq(quoteDetail.quoteId, id));
    if (n!.n === 0)
      return fail("missing_fields", "Add at least one line before activating the quote.");
    const [q] = await tx
      .update(quote)
      .set({ status: "active", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(quote.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: id,
      action: "activate",
      changes: { status: { from: "draft", to: "active" } },
    });
    return { ok: true as const, quote: q! };
  });
}

/** The active quote becomes Revised and a draft copy (QUO-00001-R1, -R2, ...) takes its place. */
export async function reviseQuote(
  ctx: Ctx,
  id: string,
): Promise<Result<{ quote: Quote; revised: Quote }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!can(ctx.subject, "quote", "create")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id, "write");
    if (denied) return denied;
    if (row.status !== "active") return fail("read_only", "Only an active quote can be revised.");
    const lines = await tx
      .select()
      .from(quoteDetail)
      .where(eq(quoteDetail.quoteId, id))
      .orderBy(asc(quoteDetail.lineNumber));
    const [max] = await tx
      .select({ r: sql<number>`max(${quote.revisionNumber})` })
      .from(quote)
      .where(and(eq(quote.baseNumber, row.baseNumber)));
    const revision = Number(max!.r) + 1;
    const [old] = await tx
      .update(quote)
      .set({ status: "revised", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(quote.id, id))
      .returning();
    const copy = omit(row, ["id", "quoteNumber", "createdAt", "modifiedAt", "status"]);
    const [fresh] = await tx
      .insert(quote)
      .values({
        ...copy,
        revisionNumber: revision,
        quoteNumber: `${row.baseNumber}-R${revision}`,
        status: "draft",
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
      })
      .returning();
    if (lines.length > 0) {
      await tx
        .insert(quoteDetail)
        .values(lines.map((l) => ({ ...omit(l, ["id", "quoteId"]), quoteId: fresh!.id })));
    }
    const q = await recalc(tx, fresh!.id);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: id,
      action: "revise",
      changes: { revisedTo: q.quoteNumber },
    });
    return { ok: true as const, quote: q, revised: old! };
  });
}

/**
 * Win: the active quote becomes Won, a sales order is created from its lines, and (optionally)
 * the opportunity is closed as Won with the quote total as revenue and its account made a Customer.
 */
export async function winQuote(
  ctx: Ctx,
  id: string,
  opts: { closeOpportunity?: boolean } = {},
): Promise<Result<{ quote: Quote; order: SalesOrder; opportunityClosed: boolean }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!can(ctx.subject, "order", "create")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id, "write");
    if (denied) return denied;
    if (row.status !== "active") return fail("read_only", "Only an active quote can be won.");
    const lines = await tx
      .select()
      .from(quoteDetail)
      .where(eq(quoteDetail.quoteId, id))
      .orderBy(asc(quoteDetail.lineNumber));
    const [q] = await tx
      .update(quote)
      .set({ status: "won", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(quote.id, id))
      .returning();
    const [order] = await tx
      .insert(salesOrder)
      .values({
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        orderNumber: await nextNumber(tx, ctx.tenantId, "order"),
        quoteId: id,
        opportunityId: row.opportunityId,
        customerAccountId: row.customerAccountId,
        customerContactId: row.customerContactId,
        name: row.name,
        subtotalCents: row.subtotalCents,
        discountCents: row.discountCents,
        freightCents: row.freightCents,
        taxCents: row.taxCents,
        totalCents: row.totalCents,
      })
      .returning();
    if (lines.length > 0) {
      await tx.insert(salesOrderDetail).values(
        lines.map((l) => ({
          tenantId: ctx.tenantId,
          orderId: order!.id,
          lineNumber: l.lineNumber,
          productId: l.productId,
          description: l.description,
          quantityMilli: l.quantityMilli,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          taxRateBp: l.taxRateBp,
          extendedCents: l.extendedCents,
        })),
      );
    }
    let opportunityClosed = false;
    if (opts.closeOpportunity && row.opportunityId) {
      const [o] = await tx
        .select()
        .from(opportunity)
        .where(eq(opportunity.id, row.opportunityId))
        .for("update");
      if (o && o.status === "open" && !checkRecord(ctx, "opportunity", "write", o)) {
        await tx
          .update(opportunity)
          .set({
            status: "won",
            stage: "close",
            probability: 100,
            actualRevenueCents: row.totalCents,
            actualCloseDate: new Date().toISOString().slice(0, 10),
            modifiedAt: new Date(),
            modifiedBy: ctx.userId,
          })
          .where(eq(opportunity.id, o.id));
        if (o.customerAccountId) {
          await tx
            .update(account)
            .set({ relationshipType: "customer", modifiedAt: new Date(), modifiedBy: ctx.userId })
            .where(
              and(
                eq(account.id, o.customerAccountId),
                sql`${account.relationshipType} <> 'customer'`,
              ),
            );
        }
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entity: "opportunity",
          recordId: o.id,
          action: "close_won",
          changes: { viaQuote: row.quoteNumber },
        });
        opportunityClosed = true;
      }
    }
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: id,
      action: "win",
      changes: { orderNumber: order!.orderNumber },
    });
    return { ok: true as const, quote: q!, order: order!, opportunityClosed };
  });
}

export async function loseQuote(ctx: Ctx, id: string): Promise<Result<{ quote: Quote }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id, "write");
    if (denied) return denied;
    if (row.status !== "active")
      return fail("read_only", "Only an active quote can be closed as lost.");
    const [q] = await tx
      .update(quote)
      .set({ status: "lost", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(quote.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: id,
      action: "lose",
      changes: { status: { from: "active", to: "lost" } },
    });
    return { ok: true as const, quote: q! };
  });
}

export async function getOrder(
  ctx: Ctx,
  id: string,
): Promise<Result<{ order: SalesOrder; lines: (typeof salesOrderDetail.$inferSelect)[] }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(salesOrder).where(eq(salesOrder.id, id));
    const denied = checkRecord(ctx, "order", "read", row);
    if (denied) return denied;
    const lines = await tx
      .select()
      .from(salesOrderDetail)
      .where(eq(salesOrderDetail.orderId, id))
      .orderBy(asc(salesOrderDetail.lineNumber));
    return { ok: true as const, order: row!, lines };
  });
}

export async function listOrders(
  ctx: Ctx,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: SalesOrder[]; total: number }>> {
  const scope = readScope(ctx.subject, "order", salesOrder.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const q = opts.search?.trim();
  const where = and(scope.where, q ? ilike(salesOrder.name, `%${q}%`) : undefined);
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(salesOrder)
      .where(where)
      .orderBy(desc(salesOrder.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(salesOrder).where(where);
    return { ok: true as const, rows, total: total!.n };
  });
}
