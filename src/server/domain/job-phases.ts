import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  jobPhase,
  resourceBooking,
  workOrder,
  workOrderProduct,
  workOrderService,
} from "@/db/schema";
import { say } from "@/lib/vocabulary";
import { recordAudit } from "./audit";
import { NOT_FOUND, checkRecord, fail, type Ctx, type Result } from "./context";
import { invalid, text } from "./leads";
import {
  canPhaseTransition,
  isOpenPhase,
  isPhaseEditable,
  isPhaseStatus,
  jobAcceptsPhases,
  type PhaseStatus,
} from "./job-phase-status";

// Phases of a job: each is a small job inside the main job (its own title, instructions, status
// and time estimate). Whoever can edit the job can add and change its phases. A phase can only be
// added while the main job's own work is still open, and the main job can only be completed when
// no phase is open (see setWorkOrderStatus). Each change is audited against the main job.

export type JobPhase = typeof jobPhase.$inferSelect;

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;

const phaseFields = z.object({
  title: z.string().trim().min(1, "Enter a title for the phase").max(200),
  instructions: text(5000),
  estDurationMin: z.number().int().min(1).max(10_080).nullable().optional(),
});

/** Loads the main job, locked, and checks the person may change it. */
async function authorizeJob(tx: Tx, ctx: Ctx, workOrderId: string) {
  const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, workOrderId)).for("update");
  const denied = checkRecord(ctx, "work_order", "write", wo);
  return denied ? { denied } : { wo: wo! };
}

export async function listJobPhases(
  ctx: Ctx,
  workOrderId: string,
): Promise<Result<{ phases: JobPhase[] }>> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, workOrderId));
    const denied = checkRecord(ctx, "work_order", "read", wo);
    if (denied) return denied;
    const phases = await tx
      .select()
      .from(jobPhase)
      .where(eq(jobPhase.workOrderId, workOrderId))
      .orderBy(asc(jobPhase.phaseNumber));
    return { ok: true as const, phases };
  });
}

export async function addJobPhase(
  ctx: Ctx,
  workOrderId: string,
  raw: unknown,
): Promise<Result<{ phase: JobPhase }>> {
  if (!isUuid(workOrderId)) return NOT_FOUND;
  const p = phaseFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { wo, denied } = await authorizeJob(tx, ctx, workOrderId);
    if (denied) return denied;
    if (!jobAcceptsPhases(wo.status))
      return fail("read_only", `This job is ${say(wo.status)}, so phases can't be added.`);
    const [last] = await tx
      .select({ n: sql<number>`coalesce(max(${jobPhase.phaseNumber}), 0)` })
      .from(jobPhase)
      .where(eq(jobPhase.workOrderId, workOrderId));
    const [phase] = await tx
      .insert(jobPhase)
      .values({
        tenantId: ctx.tenantId,
        workOrderId,
        phaseNumber: Number(last!.n) + 1,
        title: p.data.title,
        instructions: p.data.instructions ?? null,
        estDurationMin: p.data.estDurationMin ?? null,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo.id,
      action: "add_phase",
      changes: { phase: phase!.phaseNumber, title: phase!.title },
    });
    return { ok: true as const, phase: phase! };
  });
}

export async function updateJobPhase(
  ctx: Ctx,
  phaseId: string,
  raw: unknown,
): Promise<Result<{ phase: JobPhase }>> {
  if (!isUuid(phaseId)) return NOT_FOUND;
  const p = phaseFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [existing] = await tx.select().from(jobPhase).where(eq(jobPhase.id, phaseId));
    if (!existing) return NOT_FOUND;
    const { wo, denied } = await authorizeJob(tx, ctx, existing.workOrderId);
    if (denied) return denied;
    const [row] = await tx.select().from(jobPhase).where(eq(jobPhase.id, phaseId)).for("update");
    if (!row) return NOT_FOUND;
    if (!isPhaseEditable(row.status as PhaseStatus))
      return fail("read_only", `This phase is ${say(row.status)} and can't be edited.`);
    const patch = Object.fromEntries(
      Object.entries(p.data).filter(([, v]) => v !== undefined),
    ) as Partial<typeof jobPhase.$inferInsert>;
    if (Object.keys(patch).length === 0) return { ok: true as const, phase: row };
    const [phase] = await tx
      .update(jobPhase)
      .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(jobPhase.id, phaseId))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo.id,
      action: "update_phase",
      changes: { phase: row.phaseNumber, fields: Object.keys(patch) },
    });
    return { ok: true as const, phase: phase! };
  });
}

export async function setJobPhaseStatus(
  ctx: Ctx,
  phaseId: string,
  to: unknown,
): Promise<Result<{ phase: JobPhase }>> {
  if (!isUuid(phaseId)) return NOT_FOUND;
  if (!isPhaseStatus(to)) return fail("invalid", "That isn't a phase status.");
  return withTenant(ctx.tenantId, async (tx) => {
    const [existing] = await tx.select().from(jobPhase).where(eq(jobPhase.id, phaseId));
    if (!existing) return NOT_FOUND;
    const { wo, denied } = await authorizeJob(tx, ctx, existing.workOrderId);
    if (denied) return denied;
    if (!jobAcceptsPhases(wo.status))
      return fail("read_only", `This job is ${say(wo.status)}, so its phases can't be changed.`);
    const [row] = await tx.select().from(jobPhase).where(eq(jobPhase.id, phaseId)).for("update");
    if (!row) return NOT_FOUND;
    if (!canPhaseTransition(row.status as PhaseStatus, to))
      return fail(
        "conflict",
        `A ${row.status.replace("_", " ")} phase can't go to ${to.replace("_", " ")}.`,
      );
    const now = new Date();
    // Cancelling a phase cancels its booked visits that haven't started. A visit that is under
    // way has to be finished or cancelled by the technician first.
    let cancelledVisits = 0;
    if (to === "cancelled") {
      const live = await tx
        .select()
        .from(resourceBooking)
        .where(
          and(
            eq(resourceBooking.phaseId, phaseId),
            inArray(resourceBooking.status, ["scheduled", "travelling", "in_progress"]),
          ),
        );
      if (live.some((b) => b.status === "travelling" || b.status === "in_progress"))
        return fail(
          "conflict",
          "A visit for this phase is under way. Finish or cancel the visit first.",
        );
      for (const b of live) {
        await tx
          .update(resourceBooking)
          .set({ status: "cancelled", modifiedAt: now, modifiedBy: ctx.userId })
          .where(eq(resourceBooking.id, b.id));
      }
      cancelledVisits = live.length;
      if (cancelledVisits > 0 && wo.status === "scheduled") {
        const others = await tx
          .select({ id: resourceBooking.id })
          .from(resourceBooking)
          .where(
            and(
              eq(resourceBooking.workOrderId, wo.id),
              inArray(resourceBooking.status, ["scheduled", "travelling", "in_progress"]),
            ),
          );
        if (others.length === 0)
          await tx
            .update(workOrder)
            .set({ status: "unscheduled", modifiedAt: now, modifiedBy: ctx.userId })
            .where(eq(workOrder.id, wo.id));
      }
    }
    const [phase] = await tx
      .update(jobPhase)
      .set({
        status: to,
        completedAt: to === "completed" ? now : null,
        modifiedAt: now,
        modifiedBy: ctx.userId,
      })
      .where(eq(jobPhase.id, phaseId))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo.id,
      action: "phase_status",
      changes: {
        phase: row.phaseNumber,
        status: { from: row.status, to },
        ...(cancelledVisits > 0 ? { cancelledVisits } : {}),
      },
    });
    return { ok: true as const, phase: phase! };
  });
}

/** Phases that are unscheduled (or cancelled) and have nothing recorded can be removed. */
export async function removeJobPhase(
  ctx: Ctx,
  phaseId: string,
): Promise<Result<{ removed: true }>> {
  if (!isUuid(phaseId)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [existing] = await tx.select().from(jobPhase).where(eq(jobPhase.id, phaseId));
    if (!existing) return NOT_FOUND;
    const { wo, denied } = await authorizeJob(tx, ctx, existing.workOrderId);
    if (denied) return denied;
    if (!jobAcceptsPhases(wo.status))
      return fail("read_only", `This job is ${say(wo.status)}, so its phases can't be changed.`);
    const [row] = await tx.select().from(jobPhase).where(eq(jobPhase.id, phaseId)).for("update");
    if (!row) return NOT_FOUND;
    if (row.status !== "unscheduled" && row.status !== "cancelled")
      return fail(
        "conflict",
        "Only a phase that hasn't started can be removed. Cancel it instead.",
      );
    const [hasPart] = await tx
      .select({ id: workOrderProduct.id })
      .from(workOrderProduct)
      .where(eq(workOrderProduct.phaseId, phaseId))
      .limit(1);
    const [hasLabour] = await tx
      .select({ id: workOrderService.id })
      .from(workOrderService)
      .where(eq(workOrderService.phaseId, phaseId))
      .limit(1);
    if (hasPart || hasLabour)
      return fail(
        "conflict",
        "This phase has parts or labour recorded, so it can't be removed. Cancel it instead.",
      );
    await tx.delete(jobPhase).where(eq(jobPhase.id, phaseId));
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo.id,
      action: "remove_phase",
      changes: { phase: row.phaseNumber, title: row.title },
    });
    return { ok: true as const, removed: true as const };
  });
}

// ---- Rules the main job applies to its phases (called inside the job's own transaction) ----------

/** How many phases of this job are still open. */
export async function countOpenPhases(tx: Tx, workOrderId: string): Promise<number> {
  const rows = await tx
    .select({ status: jobPhase.status })
    .from(jobPhase)
    .where(eq(jobPhase.workOrderId, workOrderId));
  return rows.filter((r) => isOpenPhase(r.status)).length;
}

/** Cancelling the main job cancels every phase that is still open. Returns how many. */
export async function cancelOpenPhases(tx: Tx, ctx: Ctx, workOrderId: string): Promise<number> {
  const open = await tx
    .select()
    .from(jobPhase)
    .where(and(eq(jobPhase.workOrderId, workOrderId)));
  const targets = open.filter((r) => isOpenPhase(r.status));
  for (const ph of targets) {
    await tx
      .update(jobPhase)
      .set({
        status: "cancelled",
        completedAt: null,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(jobPhase.id, ph.id));
  }
  return targets.length;
}
