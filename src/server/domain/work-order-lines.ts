import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  bookableResource,
  product,
  resourceBooking,
  workOrder,
  workOrderProduct,
  workOrderService,
} from "@/db/schema";
import { recordAudit } from "./audit";
import { unitPriceFor } from "./catalog";
import { FORBIDDEN, NOT_FOUND, checkRecord, fail, type Ctx, type Result } from "./context";
import { invalid } from "./leads";
import { labourAmountCents, partAmountCents } from "./quote-math";

// Parts and labour used on a work order. They can be recorded from the time the work is booked
// until the work order is posted (posted work feeds an invoice and is final) or cancelled.
// Dispatchers (who can edit work orders) can change them; a technician can add and remove their
// own entries on a job they are booked on, but only dispatchers set labour rates.

export type WorkOrderPart = typeof workOrderProduct.$inferSelect;
export type WorkOrderLabour = typeof workOrderService.$inferSelect;

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const money = z.number().int().min(0).max(1e12);
const LOCKED = ["posted", "cancelled"];

export const partFields = z.object({
  productId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(300).optional(),
  quantity: z.number().min(0.001).max(1_000_000),
  unitPriceCents: money.optional(), // defaults to the product's list price
});

export const labourFields = z.object({
  description: z.string().trim().min(1, "Describe the work").max(300),
  minutes: z.number().int().min(1, "Enter the minutes worked").max(100_000),
  hourlyRateCents: money,
  resourceId: z.string().uuid().nullable().optional(),
});

/** Who may change a work order's parts and labour: whoever can edit it, or a technician booked on it. */
async function authorize(tx: Tx, ctx: Ctx, workOrderId: string, what: "part" | "labour") {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, workOrderId)).for("update");
  const readDenied = checkRecord(ctx, "work_order", "read", wo);
  if (readDenied) return { denied: readDenied };
  if (LOCKED.includes(wo!.status)) {
    return {
      denied: fail(
        "read_only",
        `This work order is ${wo!.status}, so its parts and labour can't be changed.`,
      ),
    };
  }
  if (!checkRecord(ctx, "work_order", "write", wo)) return { wo: wo!, dispatcher: true };
  // Not a dispatcher: allowed to record parts on a job they are booked on, never labour rates.
  if (what === "part") {
    const mine = await tx
      .select({ id: resourceBooking.id })
      .from(resourceBooking)
      .where(
        and(
          eq(resourceBooking.workOrderId, workOrderId),
          eq(resourceBooking.ownerId, ctx.userId),
          inArray(resourceBooking.status, ["scheduled", "travelling", "in_progress", "completed"]),
        ),
      );
    if (mine.length > 0) return { wo: wo!, dispatcher: false };
  }
  return { denied: FORBIDDEN };
}

export async function addPart(
  ctx: Ctx,
  workOrderId: string,
  raw: unknown,
): Promise<Result<{ part: WorkOrderPart }>> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  const p = partFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { wo, denied } = await authorize(tx, ctx, workOrderId, "part");
    if (denied) return denied;
    let description = p.data.description?.trim() ?? "";
    let price = p.data.unitPriceCents;
    if (p.data.productId) {
      const [pr] = await tx.select().from(product).where(eq(product.id, p.data.productId));
      if (!pr) return fail("invalid", "That product doesn't exist.");
      description ||= pr.name;
      price ??= (await unitPriceFor(tx, pr.id, null)) ?? 0;
    }
    if (!description) return fail("invalid", "Describe the part.");
    if (price === undefined) return fail("invalid", "Enter a unit price.");
    const quantityMilli = Math.round(p.data.quantity * 1000);
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${workOrderProduct.lineNumber}), 0)` })
      .from(workOrderProduct)
      .where(eq(workOrderProduct.workOrderId, workOrderId));
    const [part] = await tx
      .insert(workOrderProduct)
      .values({
        tenantId: ctx.tenantId,
        workOrderId,
        lineNumber: Number(last!.n) + 1,
        productId: p.data.productId ?? null,
        description,
        quantityMilli,
        unitPriceCents: price,
        extendedCents: partAmountCents(quantityMilli, price),
        addedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo!.id,
      action: "add_part",
      changes: { line: part!.lineNumber, description, extendedCents: part!.extendedCents },
    });
    return { ok: true as const, part: part! };
  });
}

export async function addLabour(
  ctx: Ctx,
  workOrderId: string,
  raw: unknown,
): Promise<Result<{ labour: WorkOrderLabour }>> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  const p = labourFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { wo, denied } = await authorize(tx, ctx, workOrderId, "labour");
    if (denied) return denied;
    if (p.data.resourceId) {
      const [r] = await tx
        .select({ id: bookableResource.id })
        .from(bookableResource)
        .where(eq(bookableResource.id, p.data.resourceId));
      if (!r) return fail("invalid", "That resource doesn't exist.");
    }
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${workOrderService.lineNumber}), 0)` })
      .from(workOrderService)
      .where(eq(workOrderService.workOrderId, workOrderId));
    const [labour] = await tx
      .insert(workOrderService)
      .values({
        tenantId: ctx.tenantId,
        workOrderId,
        lineNumber: Number(last!.n) + 1,
        resourceId: p.data.resourceId ?? null,
        description: p.data.description,
        minutes: p.data.minutes,
        hourlyRateCents: p.data.hourlyRateCents,
        extendedCents: labourAmountCents(p.data.minutes, p.data.hourlyRateCents),
        addedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo!.id,
      action: "add_labour",
      changes: {
        line: labour!.lineNumber,
        minutes: labour!.minutes,
        extendedCents: labour!.extendedCents,
      },
    });
    return { ok: true as const, labour: labour! };
  });
}

async function renumber(
  tx: Tx,
  table: typeof workOrderProduct | typeof workOrderService,
  workOrderId: string,
) {
  // Two passes so the unique (work order, line number) index never sees a duplicate.
  const rest = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.workOrderId, workOrderId))
    .orderBy(asc(table.lineNumber));
  for (const [i, r] of rest.entries())
    await tx
      .update(table)
      .set({ lineNumber: -(i + 1) })
      .where(eq(table.id, r.id));
  for (const [i, r] of rest.entries())
    await tx
      .update(table)
      .set({ lineNumber: i + 1 })
      .where(eq(table.id, r.id));
}

/** A technician may only remove what they added themselves; dispatchers may remove anything. */
export async function removePart(ctx: Ctx, workOrderId: string, lineId: string): Promise<Result> {
  if (!isUuid(workOrderId) || !isUuid(lineId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { wo, dispatcher, denied } = await authorize(tx, ctx, workOrderId, "part");
    if (denied) return denied;
    const [line] = await tx
      .select()
      .from(workOrderProduct)
      .where(and(eq(workOrderProduct.id, lineId), eq(workOrderProduct.workOrderId, workOrderId)));
    if (!line) return NOT_FOUND;
    if (!dispatcher && line.addedBy !== ctx.userId) return FORBIDDEN;
    await tx.delete(workOrderProduct).where(eq(workOrderProduct.id, lineId));
    await renumber(tx, workOrderProduct, workOrderId);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo!.id,
      action: "remove_part",
      changes: { description: line.description },
    });
    return { ok: true as const };
  });
}

export async function removeLabour(ctx: Ctx, workOrderId: string, lineId: string): Promise<Result> {
  if (!isUuid(workOrderId) || !isUuid(lineId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { wo, denied } = await authorize(tx, ctx, workOrderId, "labour");
    if (denied) return denied;
    const gone = await tx
      .delete(workOrderService)
      .where(and(eq(workOrderService.id, lineId), eq(workOrderService.workOrderId, workOrderId)))
      .returning({ id: workOrderService.id });
    if (gone.length === 0) return NOT_FOUND;
    await renumber(tx, workOrderService, workOrderId);
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo!.id,
      action: "remove_labour",
    });
    return { ok: true as const };
  });
}

/** Parts, labour and their totals, for anyone who can read the work order. */
export async function listWorkOrderLines(
  ctx: Ctx,
  workOrderId: string,
): Promise<
  Result<{
    parts: WorkOrderPart[];
    labour: WorkOrderLabour[];
    partsCents: number;
    labourCents: number;
    totalCents: number;
  }>
> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, workOrderId));
    const denied = checkRecord(ctx, "work_order", "read", wo);
    if (denied) return denied;
    const parts = await tx
      .select()
      .from(workOrderProduct)
      .where(eq(workOrderProduct.workOrderId, workOrderId))
      .orderBy(asc(workOrderProduct.lineNumber));
    const labour = await tx
      .select()
      .from(workOrderService)
      .where(eq(workOrderService.workOrderId, workOrderId))
      .orderBy(asc(workOrderService.lineNumber));
    const partsCents = parts.reduce((s, l) => s + l.extendedCents, 0);
    const labourCents = labour.reduce((s, l) => s + l.extendedCents, 0);
    return {
      ok: true as const,
      parts,
      labour,
      partsCents,
      labourCents,
      totalCents: partsCents + labourCents,
    };
  });
}

/**
 * Product names for the technician's "add a part" picker. Names only, no prices: a technician
 * records what they used, and the price comes from the catalog.
 */
export async function listProductChoices(
  ctx: Ctx,
): Promise<Result<{ rows: { id: string; label: string }[] }>> {
  if (!ctx.subject.privileges.booking?.read) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ id: product.id, name: product.name, sku: product.sku })
      .from(product)
      .where(eq(product.stateCode, "active"))
      .orderBy(asc(product.name))
      .limit(500);
    return {
      ok: true as const,
      rows: rows.map((r) => ({ id: r.id, label: `${r.name} (${r.sku})` })),
    };
  });
}
