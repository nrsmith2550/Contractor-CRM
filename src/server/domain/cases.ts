import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { account, incident, queue, subject, workOrder } from "@/db/schema";
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
import { invalid, text } from "./leads";
import { nextNumber } from "./numbering";
import { PRIORITIES, slaDueAt, type Priority } from "./sla";
import type { WorkOrder } from "./work-orders";

// Cases ("incidents"): a customer's service request. Active statuses are In Progress, On Hold
// and Waiting on Customer; Resolved and Cancelled are closed (and can be reactivated). The SLA
// due time comes from the priority (sla.ts). A case with open work orders can't be closed.

export type Case = typeof incident.$inferSelect;

export const ACTIVE_STATUSES = ["in_progress", "on_hold", "waiting_on_customer"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
const isActive = (s: string) => (ACTIVE_STATUSES as readonly string[]).includes(s);
const OPEN_WO = ["unscheduled", "scheduled", "in_progress"];

export const CASE_VIEWS = [
  { id: "my_active", label: "My Active Cases" },
  { id: "all_active", label: "All Active Cases" },
  { id: "resolved", label: "Resolved Cases" },
] as const;
export type CaseView = (typeof CASE_VIEWS)[number]["id"];

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const uuidOrNull = z.string().uuid().nullable().optional();
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export const caseFields = z.object({
  title: z.string().trim().min(1, "Enter a title").max(200),
  customerAccountId: uuidOrNull,
  customerContactId: uuidOrNull,
  subjectId: uuidOrNull,
  queueId: uuidOrNull,
  caseType: z.enum(["question", "problem", "request"]).optional(),
  priority: z.enum(PRIORITIES).optional(),
  origin: z.enum(["phone", "email", "web"]).optional(),
  description: text(5000),
});

async function checkLinks(
  tx: Tx,
  ctx: Ctx,
  d: z.infer<typeof caseFields> | Partial<z.infer<typeof caseFields>>,
) {
  if (d.customerAccountId) {
    const [a] = await tx.select().from(account).where(eq(account.id, d.customerAccountId));
    if (checkRecord(ctx, "account", "read", a))
      return fail("invalid", "That account doesn't exist or you don't have access to it.");
  }
  if (d.subjectId) {
    const [s] = await tx
      .select({ id: subject.id })
      .from(subject)
      .where(eq(subject.id, d.subjectId));
    if (!s) return fail("invalid", "That subject doesn't exist.");
  }
  if (d.queueId) {
    const [q] = await tx.select({ id: queue.id }).from(queue).where(eq(queue.id, d.queueId));
    if (!q) return fail("invalid", "That queue doesn't exist.");
  }
  return null;
}

export async function createCase(ctx: Ctx, raw: unknown): Promise<Result<{ case: Case }>> {
  if (!can(ctx.subject, "case", "create")) return FORBIDDEN;
  const p = caseFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const bad = await checkLinks(tx, ctx, p.data);
    if (bad) return bad;
    const now = new Date();
    const [row] = await tx
      .insert(incident)
      .values({
        ...p.data,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        ticketNumber: await nextNumber(tx, ctx.tenantId, "case"),
        createdAt: now,
        slaDueAt: slaDueAt(now, p.data.priority ?? "normal"),
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true as const, case: row! };
  });
}

export async function getCase(ctx: Ctx, id: string): Promise<Result<{ case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(incident).where(eq(incident.id, id));
    return checkRecord(ctx, "case", "read", row) ?? { ok: true as const, case: row! };
  });
}

export async function listCases(
  ctx: Ctx,
  opts: { view?: CaseView; search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Case[]; total: number }>> {
  const scope = readScope(ctx.subject, "case", incident.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const active = inArray(incident.status, [...ACTIVE_STATUSES]);
  const byView: Record<CaseView, SQL | undefined> = {
    my_active: and(active, eq(incident.ownerId, ctx.userId)),
    all_active: active,
    resolved: eq(incident.status, "resolved"),
  };
  const q = opts.search?.trim();
  const where = and(
    scope.where,
    byView[opts.view ?? "my_active"],
    q ? or(ilike(incident.title, `%${q}%`), ilike(incident.ticketNumber, `%${q}%`)) : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(incident)
      .where(where)
      // Active cases most urgent first (soonest due), others newest first.
      .orderBy(
        ...(opts.view === "resolved" ? [desc(incident.resolvedAt)] : [asc(incident.slaDueAt)]),
      )
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(incident).where(where);
    return { ok: true as const, rows, total: total!.n };
  });
}

async function load(tx: Tx, ctx: Ctx, id: string) {
  const [row] = await tx.select().from(incident).where(eq(incident.id, id)).for("update");
  const denied = checkRecord(ctx, "case", "write", row);
  return denied ? { denied } : { row: row! };
}

export async function updateCase(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = caseFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!isActive(row.status))
      return fail("read_only", `This case is ${row.status}. Reactivate it to make changes.`);
    const bad = await checkLinks(tx, ctx, p.data);
    if (bad) return bad;
    const patch: Record<string, unknown> = defined(p.data);
    // A new priority re-derives the due time from when the case was opened.
    if (p.data.priority && p.data.priority !== row.priority)
      patch.slaDueAt = slaDueAt(row.createdAt, p.data.priority);
    const changes = diffChanges(row as never, { ...row, ...patch } as never, Object.keys(patch));
    if (Object.keys(changes).length === 0) return { ok: true as const, case: row };
    const [updated] = await tx
      .update(incident)
      .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(incident.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: id,
      action: "update",
      changes,
    });
    return { ok: true as const, case: updated! };
  });
}

/** Switches between In Progress, On Hold and Waiting on Customer. */
export async function setCaseStatus(
  ctx: Ctx,
  id: string,
  to: unknown,
): Promise<Result<{ case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (typeof to !== "string" || !isActive(to))
    return fail("invalid", "Choose In Progress, On Hold or Waiting on Customer.");
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!isActive(row.status))
      return fail("read_only", `This case is ${row.status}. Reactivate it first.`);
    if (row.status === to) return { ok: true as const, case: row };
    const [updated] = await tx
      .update(incident)
      .set({ status: to, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(incident.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: id,
      action: "status",
      changes: { status: { from: row.status, to } },
    });
    return { ok: true as const, case: updated! };
  });
}

/** Closing a case needs its work orders finished or cancelled first. */
async function openWorkOrders(tx: Tx, caseId: string) {
  return tx
    .select({ n: workOrder.woNumber })
    .from(workOrder)
    .where(and(eq(workOrder.incidentId, caseId), inArray(workOrder.status, OPEN_WO)));
}

const resolveInput = z.object({
  resolution: z.string().trim().min(1, "Describe how the case was resolved").max(5000),
  billableMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
});

export async function resolveCase(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = resolveInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!isActive(row.status)) return fail("read_only", `This case is already ${row.status}.`);
    const open = await openWorkOrders(tx, id);
    if (open.length > 0) {
      return fail(
        "conflict",
        `Finish or cancel its work orders first: ${open.map((o) => o.n).join(", ")}.`,
      );
    }
    const now = new Date();
    const [updated] = await tx
      .update(incident)
      .set({
        status: "resolved",
        resolution: p.data.resolution,
        billableMinutes: p.data.billableMinutes ?? null,
        resolvedAt: now,
        modifiedAt: now,
        modifiedBy: ctx.userId,
      })
      .where(eq(incident.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: id,
      action: "resolve",
      changes: {
        status: { from: row.status, to: "resolved" },
        billableMinutes: p.data.billableMinutes ?? null,
      },
    });
    return { ok: true as const, case: updated! };
  });
}

export async function cancelCase(
  ctx: Ctx,
  id: string,
  reason?: unknown,
): Promise<Result<{ case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const why = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!isActive(row.status)) return fail("read_only", `This case is already ${row.status}.`);
    const open = await openWorkOrders(tx, id);
    if (open.length > 0) {
      return fail("conflict", `Cancel its work orders first: ${open.map((o) => o.n).join(", ")}.`);
    }
    const [updated] = await tx
      .update(incident)
      .set({ status: "cancelled", modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(incident.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: id,
      action: "cancel",
      changes: { status: { from: row.status, to: "cancelled" }, ...(why ? { reason: why } : {}) },
    });
    return { ok: true as const, case: updated! };
  });
}

/** Reopens a resolved or cancelled case. Its SLA clock restarts from now, by its priority. */
export async function reactivateCase(ctx: Ctx, id: string): Promise<Result<{ case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (isActive(row.status)) return fail("conflict", "This case is already active.");
    const now = new Date();
    const [updated] = await tx
      .update(incident)
      .set({
        status: "in_progress",
        resolvedAt: null,
        slaDueAt: slaDueAt(now, row.priority as Priority),
        modifiedAt: now,
        modifiedBy: ctx.userId,
      })
      .where(eq(incident.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: id,
      action: "reactivate",
      changes: { status: { from: row.status, to: "in_progress" } },
    });
    return { ok: true as const, case: updated! };
  });
}

/**
 * Creates an Unscheduled work order linked to the case. It starts from the case's customer
 * (as the service account, with that account's address when the user can read it), priority and
 * description. A case can have several work orders (one per visit).
 */
export async function convertToWorkOrder(
  ctx: Ctx,
  id: string,
  raw: unknown = {},
): Promise<Result<{ workOrder: WorkOrder; case: Case }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!can(ctx.subject, "work_order", "create")) return FORBIDDEN;
  const p = z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      workOrderType: z.enum(["repair", "maintenance", "installation", "inspection"]).optional(),
      estDurationMin: z.number().int().min(1).max(10_080).optional(),
    })
    .safeParse(raw ?? {});
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await load(tx, ctx, id);
    if (denied) return denied;
    if (!isActive(row.status))
      return fail(
        "read_only",
        `This case is ${row.status}. Reactivate it before creating work orders.`,
      );

    let addr: Partial<typeof account.$inferSelect> = {};
    if (row.customerAccountId) {
      const [a] = await tx.select().from(account).where(eq(account.id, row.customerAccountId));
      if (a && !checkRecord(ctx, "account", "read", a)) addr = a;
    }
    const [wo] = await tx
      .insert(workOrder)
      .values({
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        woNumber: await nextNumber(tx, ctx.tenantId, "work_order"),
        title: p.data.title ?? row.title,
        incidentId: row.id,
        serviceAccountId: row.customerAccountId,
        workOrderType: p.data.workOrderType ?? "repair",
        priority: row.priority,
        instructions: row.description,
        estDurationMin: p.data.estDurationMin ?? null,
        addressStreet: addr.addressStreet ?? null,
        addressCity: addr.addressCity ?? null,
        addressRegion: addr.addressRegion ?? null,
        addressPostalCode: addr.addressPostalCode ?? null,
        addressCountry: addr.addressCountry ?? null,
        status: "unscheduled",
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo!.id,
      action: "create",
      changes: { fromCase: row.ticketNumber },
    });
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "case",
      recordId: id,
      action: "convert",
      changes: { workOrder: wo!.woNumber },
    });
    return { ok: true as const, workOrder: wo!, case: row };
  });
}

// ── Subjects and queues (administrators configure these) ────────────────────────────────────────

const nameInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  parentId: uuidOrNull,
});
const uniqueViolation = (err: unknown) => {
  const code = (e: unknown) =>
    typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
};

export async function createSubject(ctx: Ctx, raw: unknown) {
  if (!can(ctx.subject, "security_role", "write")) return FORBIDDEN;
  const p = nameInput.safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      if (p.data.parentId) {
        const [parent] = await tx
          .select({ id: subject.id })
          .from(subject)
          .where(eq(subject.id, p.data.parentId));
        if (!parent) return fail("invalid", "That parent subject doesn't exist.");
      }
      const [row] = await tx
        .insert(subject)
        .values({
          name: p.data.name,
          parentId: p.data.parentId ?? null,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      return { ok: true as const, subject: row! };
    });
  } catch (err) {
    if (uniqueViolation(err))
      return fail("conflict", "A subject with that name already exists there.");
    throw err;
  }
}

export async function createQueue(ctx: Ctx, raw: unknown) {
  if (!can(ctx.subject, "security_role", "write")) return FORBIDDEN;
  const p = nameInput.pick({ name: true }).safeParse(raw);
  if (!p.success) return invalid(p);
  try {
    return await withTenant(ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(queue)
        .values({
          name: p.data.name,
          tenantId: ctx.tenantId,
          ownerId: ctx.userId,
          createdBy: ctx.userId,
          modifiedBy: ctx.userId,
        })
        .returning();
      return { ok: true as const, queue: row! };
    });
  } catch (err) {
    if (uniqueViolation(err)) return fail("conflict", "A queue with that name already exists.");
    throw err;
  }
}

export async function listSubjects(ctx: Ctx) {
  if (!can(ctx.subject, "case", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => ({
    ok: true as const,
    rows: await tx.select().from(subject).orderBy(asc(subject.name)),
  }));
}

export async function listQueues(ctx: Ctx) {
  if (!can(ctx.subject, "case", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => ({
    ok: true as const,
    rows: await tx.select().from(queue).orderBy(asc(queue.name)),
  }));
}
