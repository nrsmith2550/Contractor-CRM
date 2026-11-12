import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { account, workOrder } from "@/db/schema";
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
import { PRIORITIES } from "./sla";
import { canTransition, isEditable, isWoStatus, type WoStatus } from "./work-order-status";

// Work orders: the on-site job. Status moves through work-order-status.ts. Once the work is
// completed (or posted, or cancelled) the details are read-only.

export type WorkOrder = typeof workOrder.$inferSelect;

export const WO_VIEWS = [
  { id: "unscheduled", label: "Unscheduled Work Orders" },
  { id: "active", label: "Scheduled and In Progress" },
  { id: "completed", label: "Completed" },
  { id: "all_open", label: "All Open Work Orders" },
] as const;
export type WoView = (typeof WO_VIEWS)[number]["id"];

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const when = z.preprocess(blankToNull, z.coerce.date().nullable().optional());
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const baseFields = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  serviceAccountId: z.string().uuid().nullable().optional(),
  incidentType: text(120),
  workOrderType: z.enum(["repair", "maintenance", "installation", "inspection"]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  instructions: text(5000),
  ...addressFields,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timeWindowStart: when,
  timeWindowEnd: when,
  estDurationMin: z.number().int().min(1).max(10_080).nullable().optional(),
});

const windowOk = (d: { timeWindowStart?: Date | null; timeWindowEnd?: Date | null }) =>
  !d.timeWindowStart || !d.timeWindowEnd || d.timeWindowEnd > d.timeWindowStart;
const WINDOW_MSG = "The time window must end after it starts.";

export const workOrderFields = baseFields.refine(windowOk, {
  message: WINDOW_MSG,
  path: ["timeWindowEnd"],
});

async function checkAccount(tx: Tx, ctx: Ctx, id: string | null | undefined) {
  if (!id) return null;
  const [a] = await tx.select().from(account).where(eq(account.id, id));
  return checkRecord(ctx, "account", "read", a)
    ? fail("invalid", "That account doesn't exist or you don't have access to it.")
    : null;
}

export async function createWorkOrder(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ workOrder: WorkOrder }>> {
  if (!can(ctx.subject, "work_order", "create")) return FORBIDDEN;
  const p = workOrderFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const bad = await checkAccount(tx, ctx, p.data.serviceAccountId);
    if (bad) return bad;
    const [row] = await tx
      .insert(workOrder)
      .values({
        ...p.data,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        woNumber: await nextNumber(tx, ctx.tenantId, "work_order"),
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true as const, workOrder: row! };
  });
}

export async function getWorkOrder(
  ctx: Ctx,
  id: string,
): Promise<Result<{ workOrder: WorkOrder }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(workOrder).where(eq(workOrder.id, id));
    return checkRecord(ctx, "work_order", "read", row) ?? { ok: true as const, workOrder: row! };
  });
}

export async function listWorkOrders(
  ctx: Ctx,
  opts: {
    view?: WoView;
    search?: string;
    incidentId?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<Result<{ rows: WorkOrder[]; total: number }>> {
  const scope = readScope(ctx.subject, "work_order", workOrder.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const byView: Record<WoView, SQL | undefined> = {
    unscheduled: eq(workOrder.status, "unscheduled"),
    active: inArray(workOrder.status, ["scheduled", "in_progress"]),
    completed: inArray(workOrder.status, ["completed", "posted"]),
    all_open: inArray(workOrder.status, ["unscheduled", "scheduled", "in_progress"]),
  };
  const q = opts.search?.trim();
  const where = and(
    scope.where,
    byView[opts.view ?? "all_open"],
    opts.incidentId ? eq(workOrder.incidentId, opts.incidentId) : undefined,
    q ? or(ilike(workOrder.title, `%${q}%`), ilike(workOrder.woNumber, `%${q}%`)) : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(workOrder)
      .where(where)
      .orderBy(
        opts.view === "completed" ? desc(workOrder.modifiedAt) : asc(workOrder.timeWindowStart),
        desc(workOrder.createdAt),
      )
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(workOrder).where(where);
    return { ok: true as const, rows, total: total!.n };
  });
}

async function load(tx: Tx, ctx: Ctx, id: string) {
  const [row] = await tx.select().from(workOrder).where(eq(workOrder.id, id)).for("update");
  const denied = checkRecord(ctx, "work_order", "write", row);
  return denied ? { denied } : { row: row! };
}

export async function updateWorkOrder(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ workOrder: WorkOrder }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = baseFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!isEditable(row.status as WoStatus))
      return fail("read_only", `This work order is ${row.status} and can't be edited.`);
    const patch = defined(p.data);
    // The window rule needs the final values, so merge with what's stored.
    const merged = {
      timeWindowStart: (patch.timeWindowStart ?? row.timeWindowStart) as Date | null,
      timeWindowEnd: (patch.timeWindowEnd ?? row.timeWindowEnd) as Date | null,
    };
    if (!windowOk(merged))
      return fail("invalid", WINDOW_MSG, {
        issues: [{ path: "timeWindowEnd", message: WINDOW_MSG }],
      });
    const bad = await checkAccount(tx, ctx, patch.serviceAccountId);
    if (bad) return bad;
    const changes = diffChanges(row as never, { ...row, ...patch } as never, Object.keys(patch));
    if (Object.keys(changes).length === 0) return { ok: true as const, workOrder: row };
    const [updated] = await tx
      .update(workOrder)
      .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(workOrder.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: id,
      action: "update",
      changes,
    });
    return { ok: true as const, workOrder: updated! };
  });
}

/** Moves a work order along its status flow; the rules are in work-order-status.ts. */
export async function setWorkOrderStatus(
  ctx: Ctx,
  id: string,
  to: unknown,
): Promise<Result<{ workOrder: WorkOrder }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!isWoStatus(to)) return fail("invalid", "That isn't a work order status.");
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!canTransition(row.status as WoStatus, to)) {
      return fail(
        "conflict",
        `A ${row.status.replace("_", " ")} work order can't go to ${to.replace("_", " ")}.`,
      );
    }
    const [updated] = await tx
      .update(workOrder)
      .set({ status: to, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(workOrder.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: id,
      action: "status",
      changes: { status: { from: row.status, to } },
    });
    return { ok: true as const, workOrder: updated! };
  });
}
