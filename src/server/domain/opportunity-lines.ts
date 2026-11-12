import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { opportunity, opportunityProduct, product } from "@/db/schema";
import { recordAudit } from "./audit";
import { unitPriceFor } from "./catalog";
import { NOT_FOUND, checkRecord, fail, type Ctx, type Result } from "./context";
import { invalid } from "./leads";
import { calculateQuote } from "./quote-math";

// Product lines on an opportunity. They make the opportunity's estimated revenue a calculated
// number (the sum of the lines' amounts); with no lines the user types it in. Lines can only be
// changed while the opportunity is open, by someone who can edit it.

export type OpportunityLine = typeof opportunityProduct.$inferSelect;

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const money = z.number().int().min(0).max(1e12);

export const opportunityLineFields = z.object({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(300).optional(),
  quantity: z.number().min(0).max(1_000_000),
  unitPriceCents: money.optional(), // defaults to the product's list price
  discountCents: money.optional(),
});

/** Estimated revenue from the lines (untaxed: quantity x price - discount, summed). */
async function recalc(tx: Tx, ctx: Ctx, oppId: string, before: number): Promise<number> {
  const lines = await tx
    .select()
    .from(opportunityProduct)
    .where(eq(opportunityProduct.opportunityId, oppId))
    .orderBy(asc(opportunityProduct.lineNumber));
  const totals = calculateQuote(
    lines.map((l) => ({
      quantity: l.quantityMilli / 1000,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
    })),
  );
  for (const [i, l] of lines.entries()) {
    if (l.extendedCents !== totals.lines[i]!.extendedCents) {
      await tx
        .update(opportunityProduct)
        .set({ extendedCents: totals.lines[i]!.extendedCents })
        .where(eq(opportunityProduct.id, l.id));
    }
  }
  // With no lines left the last calculated figure stays and becomes editable by hand again.
  if (lines.length === 0) return before;
  if (totals.subtotalCents !== before) {
    await tx
      .update(opportunity)
      .set({
        estRevenueCents: totals.subtotalCents,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(opportunity.id, oppId));
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: oppId,
      action: "update",
      changes: {
        estRevenueCents: { from: before, to: totals.subtotalCents },
        calculatedFromLines: true,
      },
    });
  }
  return totals.subtotalCents;
}

async function loadOpen(tx: Tx, ctx: Ctx, id: string) {
  const [row] = await tx.select().from(opportunity).where(eq(opportunity.id, id)).for("update");
  const denied = checkRecord(ctx, "opportunity", "write", row);
  if (denied) return { denied };
  if (row!.status !== "open") {
    return {
      denied: fail(
        "read_only",
        `This opportunity is ${row!.status}. Reopen it to change its products.`,
      ),
    };
  }
  return { row: row! };
}

export async function listOpportunityLines(
  ctx: Ctx,
  oppId: string,
): Promise<Result<{ lines: OpportunityLine[] }>> {
  if (!isUuid(oppId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(opportunity).where(eq(opportunity.id, oppId));
    const denied = checkRecord(ctx, "opportunity", "read", row);
    if (denied) return denied;
    const lines = await tx
      .select()
      .from(opportunityProduct)
      .where(eq(opportunityProduct.opportunityId, oppId))
      .orderBy(asc(opportunityProduct.lineNumber));
    return { ok: true as const, lines };
  });
}

export async function addOpportunityLine(
  ctx: Ctx,
  oppId: string,
  raw: unknown,
): Promise<Result<{ line: OpportunityLine; estRevenueCents: number }>> {
  if (!isUuid(oppId)) return NOT_FOUND;
  const p = opportunityLineFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, oppId);
    if (denied) return denied;

    let description = p.data.description?.trim() ?? "";
    let unitPrice = p.data.unitPriceCents;
    if (p.data.productId) {
      const [pr] = await tx.select().from(product).where(eq(product.id, p.data.productId));
      if (!pr) return fail("invalid", "That product doesn't exist.");
      description ||= pr.name;
      unitPrice ??= (await unitPriceFor(tx, pr.id, null)) ?? 0;
    }
    if (!description) return fail("invalid", "Enter a description for a write-in line.");
    if (unitPrice === undefined) return fail("invalid", "Enter a unit price.");

    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${opportunityProduct.lineNumber}), 0)` })
      .from(opportunityProduct)
      .where(eq(opportunityProduct.opportunityId, oppId));
    const [line] = await tx
      .insert(opportunityProduct)
      .values({
        tenantId: ctx.tenantId,
        opportunityId: oppId,
        lineNumber: Number(last!.n) + 1,
        productId: p.data.productId ?? null,
        description,
        quantityMilli: Math.round(p.data.quantity * 1000),
        unitPriceCents: unitPrice,
        discountCents: p.data.discountCents ?? 0,
      })
      .returning();
    const est = await recalc(tx, ctx, oppId, row.estRevenueCents);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: oppId,
      action: "add_product",
      changes: { line: line!.lineNumber, description },
    });
    const [fresh] = await tx
      .select()
      .from(opportunityProduct)
      .where(eq(opportunityProduct.id, line!.id));
    return { ok: true as const, line: fresh!, estRevenueCents: est };
  });
}

export async function removeOpportunityLine(
  ctx: Ctx,
  oppId: string,
  lineId: string,
): Promise<Result<{ estRevenueCents: number }>> {
  if (!isUuid(oppId) || !isUuid(lineId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, oppId);
    if (denied) return denied;
    const gone = await tx
      .delete(opportunityProduct)
      .where(
        sql`${opportunityProduct.id} = ${lineId} and ${opportunityProduct.opportunityId} = ${oppId}`,
      )
      .returning({ id: opportunityProduct.id });
    if (gone.length === 0) return NOT_FOUND;
    // Keep line numbers contiguous (two passes so the unique index never sees a duplicate).
    const rest = await tx
      .select({ id: opportunityProduct.id })
      .from(opportunityProduct)
      .where(eq(opportunityProduct.opportunityId, oppId))
      .orderBy(asc(opportunityProduct.lineNumber));
    for (const [i, r] of rest.entries())
      await tx
        .update(opportunityProduct)
        .set({ lineNumber: -(i + 1) })
        .where(eq(opportunityProduct.id, r.id));
    for (const [i, r] of rest.entries())
      await tx
        .update(opportunityProduct)
        .set({ lineNumber: i + 1 })
        .where(eq(opportunityProduct.id, r.id));
    const est = await recalc(tx, ctx, oppId, row.estRevenueCents);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: oppId,
      action: "remove_product",
    });
    return { ok: true as const, estRevenueCents: est };
  });
}

/** True when the opportunity's revenue is calculated from its lines. */
export async function hasLines(tx: Tx, oppId: string): Promise<boolean> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)` })
    .from(opportunityProduct)
    .where(eq(opportunityProduct.opportunityId, oppId));
  return Number(r!.n) > 0;
}
