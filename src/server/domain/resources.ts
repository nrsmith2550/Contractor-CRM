import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  bookableResource,
  characteristic,
  resourceCharacteristic,
  systemUser,
  workOrder,
  workOrderSkill,
} from "@/db/schema";
import { can } from "@/server/security/roles";
import { recordAudit } from "./audit";
import { FORBIDDEN, NOT_FOUND, checkRecord, fail, type Ctx, type Result } from "./context";
import { addressFields, invalid } from "./leads";
import { defaultWorkHours, workHoursSchema, type WorkHours } from "./work-hours";
import { isEditable, type WoStatus } from "./work-order-status";
import { say } from "@/lib/vocabulary";

// Bookable resources (people, crews, equipment), the skills ("characteristics") they have, and
// the skills a work order needs. Administrators configure resources and skills; dispatchers
// then book them onto work orders (bookings.ts).

export type Characteristic = typeof characteristic.$inferSelect;
export type Resource = typeof bookableResource.$inferSelect & { workHours: WorkHours };

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const uniqueViolation = (err: unknown) => {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
};
const admin = (ctx: Ctx) => can(ctx.subject, "security_role", "write");

export async function createCharacteristic(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ characteristic: Characteristic }>> {
  if (!admin(ctx)) return FORBIDDEN;
  const p = z.object({ name: z.string().trim().min(1, "Enter a name").max(80) }).safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(characteristic)
        .values({
          name: p.data.name,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      return { ok: true as const, characteristic: row! };
    });
  } catch (err) {
    if (uniqueViolation(err)) return fail("conflict", "A skill with that name already exists.");
    throw err;
  }
}

export async function listCharacteristics(ctx: Ctx): Promise<Result<{ rows: Characteristic[] }>> {
  if (!can(ctx.subject, "booking", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => ({
    ok: true as const,
    rows: await tx.select().from(characteristic).orderBy(asc(characteristic.name)),
  }));
}

const resourceFields = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  resourceType: z.enum(["user", "crew", "equipment"]).optional(),
  userId: z.string().uuid().nullable().optional(),
  color: z.preprocess(
    (v) => (v === "" ? null : v),
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #3366cc")
      .nullable()
      .optional(),
  ),
  workHours: workHoursSchema.optional(),
  skillIds: z.array(z.string().uuid()).max(100).optional(),
  ...addressFields,
});

async function checkLinks(tx: Tx, d: { userId?: string | null; skillIds?: string[] }) {
  if (d.userId) {
    const [u] = await tx
      .select({ id: systemUser.id })
      .from(systemUser)
      .where(eq(systemUser.id, d.userId));
    if (!u) return fail("invalid", "That user doesn't exist.");
  }
  if (d.skillIds && d.skillIds.length > 0) {
    const found = await tx
      .select({ id: characteristic.id })
      .from(characteristic)
      .where(inArray(characteristic.id, d.skillIds));
    if (found.length !== new Set(d.skillIds).size)
      return fail("invalid", "One of those skills doesn't exist.");
  }
  return null;
}

async function setSkills(tx: Tx, ctx: Ctx, resourceId: string, skillIds: string[]) {
  await tx.delete(resourceCharacteristic).where(eq(resourceCharacteristic.resourceId, resourceId));
  const unique = [...new Set(skillIds)];
  if (unique.length > 0) {
    await tx.insert(resourceCharacteristic).values(
      unique.map((characteristicId) => ({
        tenantId: ctx.tenantId,
        resourceId,
        characteristicId,
      })),
    );
  }
}

export async function createResource(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ resource: Resource; skillIds: string[] }>> {
  if (!admin(ctx)) return FORBIDDEN;
  const p = resourceFields.safeParse(raw);
  if (!p.success) return invalid(p);
  const { skillIds = [], ...rest } = p.data;
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const bad = await checkLinks(tx, { userId: rest.userId, skillIds });
      if (bad) return bad;
      const [row] = await tx
        .insert(bookableResource)
        .values({
          ...rest,
          workHours: rest.workHours ?? defaultWorkHours(),
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      await setSkills(tx, ctx, row!.id, skillIds);
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "resource",
        recordId: row!.id,
        action: "create",
      });
      return { ok: true as const, resource: row as Resource, skillIds: [...new Set(skillIds)] };
    });
  } catch (err) {
    if (uniqueViolation(err))
      return fail("conflict", "A team member with that name already exists.");
    throw err;
  }
}

export async function updateResource(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ resource: Resource; skillIds: string[] }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!admin(ctx)) return FORBIDDEN;
  const p = resourceFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  const { skillIds, ...rest } = p.data;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(bookableResource)
        .where(eq(bookableResource.id, id))
        .for("update");
      if (!existing) return NOT_FOUND;
      const bad = await checkLinks(tx, { userId: rest.userId, skillIds });
      if (bad) return bad;
      const [row] = await tx
        .update(bookableResource)
        .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
        .where(eq(bookableResource.id, id))
        .returning();
      if (skillIds) await setSkills(tx, ctx, id, skillIds);
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "resource",
        recordId: id,
        action: "update",
        changes: { ...patch, ...(skillIds ? { skillIds } : {}) },
      });
      const skills = await tx
        .select({ id: resourceCharacteristic.characteristicId })
        .from(resourceCharacteristic)
        .where(eq(resourceCharacteristic.resourceId, id));
      return { ok: true as const, resource: row as Resource, skillIds: skills.map((s) => s.id) };
    });
  } catch (err) {
    if (uniqueViolation(err))
      return fail("conflict", "A team member with that name already exists.");
    throw err;
  }
}

export async function listResources(
  ctx: Ctx,
): Promise<Result<{ rows: (Resource & { skillIds: string[] })[] }>> {
  if (!can(ctx.subject, "booking", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(bookableResource)
      .where(eq(bookableResource.stateCode, "active"))
      .orderBy(asc(bookableResource.name));
    const links = await tx.select().from(resourceCharacteristic);
    return {
      ok: true as const,
      rows: rows.map((r) => ({
        ...(r as Resource),
        skillIds: links.filter((l) => l.resourceId === r.id).map((l) => l.characteristicId),
      })),
    };
  });
}

export async function getResource(
  ctx: Ctx,
  id: string,
): Promise<Result<{ resource: Resource; skillIds: string[] }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!can(ctx.subject, "booking", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(bookableResource).where(eq(bookableResource.id, id));
    if (!row) return NOT_FOUND;
    const skills = await tx
      .select({ id: resourceCharacteristic.characteristicId })
      .from(resourceCharacteristic)
      .where(eq(resourceCharacteristic.resourceId, id));
    return { ok: true as const, resource: row as Resource, skillIds: skills.map((s) => s.id) };
  });
}

/** Sets the skills a work order requires. Only while the work order can still be edited. */
export async function setWorkOrderSkills(
  ctx: Ctx,
  workOrderId: string,
  skillIds: unknown,
): Promise<Result<{ skillIds: string[] }>> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  const p = z.array(z.string().uuid()).max(100).safeParse(skillIds);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [wo] = await tx
      .select()
      .from(workOrder)
      .where(eq(workOrder.id, workOrderId))
      .for("update");
    const denied = checkRecord(ctx, "work_order", "write", wo);
    if (denied) return denied;
    if (!isEditable(wo!.status as WoStatus))
      return fail("read_only", `This job is ${say(wo!.status)} and can't be edited.`);
    const bad = await checkLinks(tx, { skillIds: p.data });
    if (bad) return bad;
    const unique = [...new Set(p.data)];
    await tx.delete(workOrderSkill).where(eq(workOrderSkill.workOrderId, workOrderId));
    if (unique.length > 0)
      await tx.insert(workOrderSkill).values(
        unique.map((characteristicId) => ({
          tenantId: ctx.tenantId,
          workOrderId,
          characteristicId,
        })),
      );
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: workOrderId,
      action: "update",
      changes: { requiredSkills: unique },
    });
    return { ok: true as const, skillIds: unique };
  });
}

export async function listWorkOrderSkills(
  ctx: Ctx,
  workOrderId: string,
): Promise<Result<{ skills: Characteristic[] }>> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, workOrderId));
    const denied = checkRecord(ctx, "work_order", "read", wo);
    if (denied) return denied;
    const links = await tx
      .select({ id: workOrderSkill.characteristicId })
      .from(workOrderSkill)
      .where(eq(workOrderSkill.workOrderId, workOrderId));
    const ids = links.map((l) => l.id);
    const skills = ids.length
      ? await tx
          .select()
          .from(characteristic)
          .where(and(inArray(characteristic.id, ids)))
          .orderBy(asc(characteristic.name))
      : [];
    return { ok: true as const, skills };
  });
}
