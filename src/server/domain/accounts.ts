import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { account, contact } from "@/db/schema";
import { can } from "@/server/security/roles";
import { diffChanges, recordAudit } from "./audit";
import {
  FORBIDDEN,
  NOT_FOUND,
  checkRecord,
  fail,
  readScope,
  type Ctx,
  type Result,
} from "./context";
import { addressFields, invalid, text } from "./leads";
import { nextNumber } from "./numbering";

export type Account = typeof account.$inferSelect;
export type Contact = typeof contact.$inferSelect;

export const RELATIONSHIP_TYPES = ["prospect", "customer", "vendor", "partner"] as const;

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const uuidOrNull = z.preprocess(blankToNull, z.string().uuid().nullable().optional());
const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export const accountFields = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(200),
  phone: text(40),
  website: text(200),
  industry: text(120),
  ...addressFields,
  relationshipType: z.enum(RELATIONSHIP_TYPES).optional(),
  creditLimitCents: z.number().int().min(0).max(1e12).nullable().optional(),
  paymentTerms: text(60),
  parentAccountId: uuidOrNull,
  primaryContactId: uuidOrNull,
});

export const contactFields = z.object({
  firstName: text(120),
  lastName: z.string().trim().min(1, "Last name is required").max(120),
  parentAccountId: uuidOrNull,
  jobTitle: text(),
  email: z.preprocess(
    blankToNull,
    z.string().trim().toLowerCase().email("Enter a valid email").max(254).nullable().optional(),
  ),
  mobile: text(40),
  businessPhone: text(40),
  ...addressFields,
  preferredContactMethod: z.preprocess(
    blankToNull,
    z.enum(["email", "phone", "mobile", "any"]).nullable().optional(),
  ),
});

// ── Accounts ────────────────────────────────────────────────────────────────

export async function createAccount(ctx: Ctx, raw: unknown): Promise<Result<{ account: Account }>> {
  if (!can(ctx.subject, "account", "create")) return FORBIDDEN;
  const p = accountFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(account)
      .values({
        ...p.data,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        accountNumber: await nextNumber(tx, ctx.tenantId, "account"),
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "account",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true, account: row! };
  });
}

export async function getAccount(ctx: Ctx, id: string): Promise<Result<{ account: Account }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(account).where(eq(account.id, id));
    return checkRecord(ctx, "account", "read", row) ?? { ok: true, account: row! };
  });
}

export async function listAccounts(
  ctx: Ctx,
  opts: { search?: string; relationshipType?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Account[]; total: number }>> {
  const scope = readScope(ctx.subject, "account", account.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const q = opts.search?.trim();
  const rel = (RELATIONSHIP_TYPES as readonly string[]).includes(opts.relationshipType ?? "")
    ? opts.relationshipType
    : undefined;
  const where = and(
    scope.where,
    rel ? eq(account.relationshipType, rel) : undefined,
    q
      ? or(
          ilike(account.name, `%${q}%`),
          ilike(account.accountNumber, `%${q}%`),
          ilike(account.phone, `%${q}%`),
        )
      : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(account)
      .where(where)
      .orderBy(desc(account.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(account).where(where);
    return { ok: true, rows, total: total!.n };
  });
}

export async function updateAccount(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ account: Account }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = accountFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(account).where(eq(account.id, id)).for("update");
    const denied = checkRecord(ctx, "account", "write", row);
    if (denied) return denied;
    const patch = defined(p.data);
    if (patch.parentAccountId === id)
      return fail("invalid", "A customer can't be their own parent.");
    const changes = diffChanges(row as never, { ...row, ...patch } as never, Object.keys(patch));
    if (Object.keys(changes).length === 0) return { ok: true, account: row! };
    const [updated] = await tx
      .update(account)
      .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(account.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "account",
      recordId: id,
      action: "update",
      changes,
    });
    return { ok: true, account: updated! };
  });
}

// ── Contacts ────────────────────────────────────────────────────────────────

export async function createContact(ctx: Ctx, raw: unknown): Promise<Result<{ contact: Contact }>> {
  if (!can(ctx.subject, "contact", "create")) return FORBIDDEN;
  const p = contactFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(contact)
      .values({
        ...p.data,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        contactNumber: await nextNumber(tx, ctx.tenantId, "contact"),
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "contact",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true, contact: row! };
  });
}

export async function getContact(ctx: Ctx, id: string): Promise<Result<{ contact: Contact }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(contact).where(eq(contact.id, id));
    return checkRecord(ctx, "contact", "read", row) ?? { ok: true, contact: row! };
  });
}

export async function listContacts(
  ctx: Ctx,
  opts: { search?: string; accountId?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Contact[]; total: number }>> {
  const scope = readScope(ctx.subject, "contact", contact.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const q = opts.search?.trim();
  const where = and(
    scope.where,
    opts.accountId && isUuid(opts.accountId)
      ? eq(contact.parentAccountId, opts.accountId)
      : undefined,
    q
      ? or(
          ilike(contact.lastName, `%${q}%`),
          ilike(contact.firstName, `%${q}%`),
          ilike(contact.email, `%${q}%`),
          ilike(contact.contactNumber, `%${q}%`),
        )
      : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(contact)
      .where(where)
      .orderBy(desc(contact.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(contact).where(where);
    return { ok: true, rows, total: total!.n };
  });
}

export async function updateContact(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ contact: Contact }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = contactFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(contact).where(eq(contact.id, id)).for("update");
    const denied = checkRecord(ctx, "contact", "write", row);
    if (denied) return denied;
    const patch = defined(p.data);
    const changes = diffChanges(row as never, { ...row, ...patch } as never, Object.keys(patch));
    if (Object.keys(changes).length === 0) return { ok: true, contact: row! };
    const [updated] = await tx
      .update(contact)
      .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(contact.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "contact",
      recordId: id,
      action: "update",
      changes,
    });
    return { ok: true, contact: updated! };
  });
}
