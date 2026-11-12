import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { priceList, priceListItem, product, taxRate, unitOfMeasure } from "@/db/schema";
import { can } from "@/server/security/roles";
import { recordAudit } from "./audit";
import { FORBIDDEN, NOT_FOUND, fail, type Ctx, type Result } from "./context";
import { invalid, text } from "./leads";

// Product catalog: units, tax rates, products and price lists. Everyone with Sales access can
// read the catalog; only roles with product / price_list write privileges can change it (by
// default administrators and sales managers). Prices are integer cents, tax rates basis points.

export type Product = typeof product.$inferSelect;
export type PriceList = typeof priceList.$inferSelect;
export type TaxRate = typeof taxRate.$inferSelect;
export type Uom = typeof unitOfMeasure.$inferSelect;

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const uuidOrNull = z.string().uuid().nullable().optional();

export const productFields = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(60),
  name: z.string().trim().min(1, "Name is required").max(200),
  description: text(2000),
  productType: z.enum(["product", "service"]).optional(),
  uomId: uuidOrNull,
  taxRateId: uuidOrNull,
  standardCostCents: z.number().int().min(0).max(1e12).nullable().optional(),
  listPriceCents: z.number().int().min(0).max(1e12).optional(),
});

/** Postgres unique violation (23505). Drizzle wraps the driver error, so look at its cause too. */
const uniqueViolation = (err: unknown): boolean => {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  const cause =
    typeof err === "object" && err !== null ? (err as { cause?: unknown }).cause : undefined;
  return code(err) === "23505" || code(cause) === "23505";
};

export async function createProduct(ctx: Ctx, raw: unknown): Promise<Result<{ product: Product }>> {
  if (!can(ctx.subject, "product", "create")) return FORBIDDEN;
  const p = productFields.safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(product)
        .values({
          ...p.data,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "product",
        recordId: row!.id,
        action: "create",
      });
      return { ok: true as const, product: row! };
    });
  } catch (err) {
    if (uniqueViolation(err)) return fail("conflict", "A product with that SKU already exists.");
    throw err;
  }
}

export async function updateProduct(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ product: Product }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!can(ctx.subject, "product", "write")) return FORBIDDEN;
  const p = productFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  const patch = Object.fromEntries(Object.entries(p.data).filter(([, v]) => v !== undefined));
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .update(product)
        .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
        .where(eq(product.id, id))
        .returning();
      if (!row) return NOT_FOUND;
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "product",
        recordId: id,
        action: "update",
        changes: patch,
      });
      return { ok: true as const, product: row };
    });
  } catch (err) {
    if (uniqueViolation(err)) return fail("conflict", "A product with that SKU already exists.");
    throw err;
  }
}

export async function listProducts(
  ctx: Ctx,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Product[]; total: number }>> {
  if (!can(ctx.subject, "product", "read")) return FORBIDDEN;
  const q = opts.search?.trim();
  const where = and(
    eq(product.stateCode, "active"),
    q ? or(ilike(product.name, `%${q}%`), ilike(product.sku, `%${q}%`)) : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(product)
      .where(where)
      .orderBy(asc(product.name))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(product).where(where);
    return { ok: true as const, rows, total: total!.n };
  });
}

export async function getProduct(ctx: Ctx, id: string): Promise<Result<{ product: Product }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!can(ctx.subject, "product", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(product).where(eq(product.id, id));
    return row ? { ok: true as const, product: row } : NOT_FOUND;
  });
}

export async function listTaxRates(ctx: Ctx): Promise<Result<{ rows: TaxRate[] }>> {
  if (!can(ctx.subject, "product", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => ({
    ok: true as const,
    rows: await tx.select().from(taxRate).orderBy(asc(taxRate.name)),
  }));
}

export async function listPriceLists(ctx: Ctx): Promise<Result<{ rows: PriceList[] }>> {
  if (!can(ctx.subject, "price_list", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => ({
    ok: true as const,
    rows: await tx
      .select()
      .from(priceList)
      .where(eq(priceList.stateCode, "active"))
      .orderBy(asc(priceList.name)),
  }));
}

export async function listPriceListItems(
  ctx: Ctx,
  priceListId: string,
): Promise<
  Result<{ rows: { productId: string; sku: string; name: string; amountCents: number }[] }>
> {
  if (!isUuid(priceListId)) return NOT_FOUND;
  if (!can(ctx.subject, "price_list", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => ({
    ok: true as const,
    rows: await tx
      .select({
        productId: product.id,
        sku: product.sku,
        name: product.name,
        amountCents: priceListItem.amountCents,
      })
      .from(priceListItem)
      .innerJoin(product, eq(product.id, priceListItem.productId))
      .where(eq(priceListItem.priceListId, priceListId))
      .orderBy(asc(product.name)),
  }));
}

export async function createTaxRate(ctx: Ctx, raw: unknown): Promise<Result<{ taxRate: TaxRate }>> {
  if (!can(ctx.subject, "product", "create")) return FORBIDDEN;
  const p = z
    .object({
      name: z.string().trim().min(1).max(80),
      rateBp: z.number().int().min(0).max(100_000),
    })
    .safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(taxRate)
        .values({
          ...p.data,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      return { ok: true as const, taxRate: row! };
    });
  } catch (err) {
    if (uniqueViolation(err)) return fail("conflict", "A tax rate with that name already exists.");
    throw err;
  }
}

export async function createUom(ctx: Ctx, raw: unknown): Promise<Result<{ uom: Uom }>> {
  if (!can(ctx.subject, "product", "create")) return FORBIDDEN;
  const p = z
    .object({
      name: z.string().trim().min(1).max(60),
      abbreviation: z.string().trim().min(1).max(12),
    })
    .safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(unitOfMeasure)
        .values({
          ...p.data,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      return { ok: true as const, uom: row! };
    });
  } catch (err) {
    if (uniqueViolation(err)) return fail("conflict", "A unit with that name already exists.");
    throw err;
  }
}

export async function createPriceList(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ priceList: PriceList }>> {
  if (!can(ctx.subject, "price_list", "create")) return FORBIDDEN;
  const p = z
    .object({
      name: z.string().trim().min(1, "Name is required").max(120),
      currency: z.string().trim().length(3).toUpperCase().optional(),
    })
    .safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(priceList)
        .values({
          ...p.data,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "price_list",
        recordId: row!.id,
        action: "create",
      });
      return { ok: true as const, priceList: row! };
    });
  } catch (err) {
    if (uniqueViolation(err))
      return fail("conflict", "A price list with that name already exists.");
    throw err;
  }
}

/** Sets (or replaces) a product's price on a price list. */
export async function setPriceListItem(
  ctx: Ctx,
  priceListId: string,
  productId: string,
  amountCents: number,
): Promise<Result> {
  if (!isUuid(priceListId) || !isUuid(productId)) return NOT_FOUND;
  if (!can(ctx.subject, "price_list", "write")) return FORBIDDEN;
  if (!Number.isInteger(amountCents) || amountCents < 0)
    return fail("invalid", "Enter a valid price.");
  return withTenant(ctx.tenantId, async (tx) => {
    const [pl] = await tx
      .select({ id: priceList.id })
      .from(priceList)
      .where(eq(priceList.id, priceListId));
    const [pr] = await tx.select({ id: product.id }).from(product).where(eq(product.id, productId));
    if (!pl || !pr) return NOT_FOUND;
    await tx
      .insert(priceListItem)
      .values({ tenantId: ctx.tenantId, priceListId, productId, amountCents })
      .onConflictDoUpdate({
        target: [priceListItem.priceListId, priceListItem.productId],
        set: { amountCents },
      });
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "price_list",
      recordId: priceListId,
      action: "set_price",
      changes: { productId, amountCents },
    });
    return { ok: true as const };
  });
}

/** The unit price to quote: the price list's entry when there is one, else the product's list price. */
export async function unitPriceFor(
  tx: Tx,
  productId: string,
  priceListId: string | null,
): Promise<number | null> {
  if (priceListId) {
    const [item] = await tx
      .select({ a: priceListItem.amountCents })
      .from(priceListItem)
      .where(
        and(eq(priceListItem.priceListId, priceListId), eq(priceListItem.productId, productId)),
      );
    if (item) return item.a;
  }
  const [p] = await tx
    .select({ a: product.listPriceCents })
    .from(product)
    .where(eq(product.id, productId));
  return p ? p.a : null;
}
