import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { account, activity, annotation, contact, lead, opportunity, quote } from "@/db/schema";
import { can, type Entity } from "@/server/security/roles";
import { recordAudit } from "./audit";
import { FORBIDDEN, NOT_FOUND, checkRecord, fail, type Ctx, type Result } from "./context";
import { invalid, text } from "./leads";

export type Note = typeof annotation.$inferSelect;
export type Activity = typeof activity.$inferSelect;

export const REGARDING_TYPES = ["lead", "account", "contact", "opportunity", "quote"] as const;
export type RegardingType = (typeof REGARDING_TYPES)[number];
export const ACTIVITY_TYPES = ["task", "phone_call", "email", "appointment"] as const;

const TABLES = { lead, account, contact, opportunity, quote } as const;

/** The record a note/activity hangs off: it must exist and the user must be able to read it. */
async function visibleRecord(tx: Tx, ctx: Ctx, type: RegardingType, id: string) {
  const table = TABLES[type];
  const [row] = await tx.select({ ownerId: table.ownerId }).from(table).where(eq(table.id, id));
  return checkRecord(ctx, type as Entity, "read", row);
}

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const when = z.preprocess(blankToNull, z.coerce.date().nullable().optional());

const noteInput = z.object({
  regardingType: z.enum(REGARDING_TYPES),
  regardingId: z.string().uuid(),
  title: text(200),
  body: z.string().trim().min(1, "Write something first").max(10_000),
});

export async function addNote(ctx: Ctx, raw: unknown): Promise<Result<{ note: Note }>> {
  if (!can(ctx.subject, "note", "create")) return FORBIDDEN;
  const p = noteInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const denied = await visibleRecord(tx, ctx, p.data.regardingType, p.data.regardingId);
    if (denied) return denied;
    const [row] = await tx
      .insert(annotation)
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
      entity: "annotation",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true, note: row! };
  });
}

const activityInput = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  subject: z.string().trim().min(1, "Enter a subject").max(200),
  description: text(5000),
  regardingType: z.preprocess(blankToNull, z.enum(REGARDING_TYPES).nullable().optional()),
  regardingId: z.preprocess(blankToNull, z.string().uuid().nullable().optional()),
  dueAt: when,
  scheduledStart: when,
  scheduledEnd: when,
  priority: z.enum(["low", "normal", "high"]).optional(),
  direction: z.preprocess(blankToNull, z.enum(["incoming", "outgoing"]).nullable().optional()),
});

export async function addActivity(ctx: Ctx, raw: unknown): Promise<Result<{ activity: Activity }>> {
  if (!can(ctx.subject, "activity", "create")) return FORBIDDEN;
  const p = activityInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const d = p.data;
  if (!!d.regardingType !== !!d.regardingId)
    return fail("invalid", "Choose both a record type and a record, or neither.");
  return withTenant(ctx.tenantId, async (tx) => {
    if (d.regardingType && d.regardingId) {
      const denied = await visibleRecord(tx, ctx, d.regardingType, d.regardingId);
      if (denied) return denied;
    }
    const [row] = await tx
      .insert(activity)
      .values({
        ...d,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "activity",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true, activity: row! };
  });
}

export async function completeActivity(
  ctx: Ctx,
  id: string,
): Promise<Result<{ activity: Activity }>> {
  if (!z.string().uuid().safeParse(id).success) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(activity).where(eq(activity.id, id)).for("update");
    const denied = checkRecord(ctx, "activity", "write", row);
    if (denied) return denied;
    if (row!.status !== "open") return fail("conflict", `This activity is already ${row!.status}.`);
    const [updated] = await tx
      .update(activity)
      .set({ status: "completed", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(activity.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "activity",
      recordId: id,
      action: "complete",
    });
    return { ok: true, activity: updated! };
  });
}

export type TimelineItem =
  { kind: "note"; at: Date; note: Note } | { kind: "activity"; at: Date; activity: Activity };

/**
 * A record's timeline, newest first: notes and activities attached to it. The user must be able
 * to read the record; individual notes/activities are then filtered by their own read depth.
 */
export async function timeline(
  ctx: Ctx,
  type: RegardingType,
  id: string,
): Promise<Result<{ items: TimelineItem[] }>> {
  if (!REGARDING_TYPES.includes(type) || !z.string().uuid().safeParse(id).success) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const denied = await visibleRecord(tx, ctx, type, id);
    if (denied) return denied;
    const [notes, acts] = await Promise.all([
      tx
        .select()
        .from(annotation)
        .where(and(eq(annotation.regardingType, type), eq(annotation.regardingId, id)))
        .orderBy(desc(annotation.createdAt))
        .limit(200),
      tx
        .select()
        .from(activity)
        .where(and(eq(activity.regardingType, type), eq(activity.regardingId, id)))
        .orderBy(desc(activity.createdAt))
        .limit(200),
    ]);
    const items: TimelineItem[] = [
      ...notes
        .filter((n) => can(ctx.subject, "note", "read", n))
        .map((note) => ({ kind: "note" as const, at: note.createdAt, note })),
      ...acts
        .filter((a) => can(ctx.subject, "activity", "read", a))
        .map((activity) => ({ kind: "activity" as const, at: activity.createdAt, activity })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { ok: true, items };
  });
}
