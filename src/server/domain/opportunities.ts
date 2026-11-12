import { and, count, desc, eq, ilike, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { account, opportunity } from "@/db/schema";
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
import {
  STAGES,
  STAGE_PROBABILITY,
  canMove,
  isStage,
  type OpportunitySnapshot,
  type Stage,
} from "./bpf";
import { invalid, text } from "./leads";
import { nextNumber } from "./numbering";

export type Opportunity = typeof opportunity.$inferSelect;

const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const uuidOrNull = z.preprocess(blankToNull, z.string().uuid().nullable().optional());
const date = z.preprocess(
  blankToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .nullable()
    .optional(),
);
const cents = z.number().int().min(0).max(1e12).nullable().optional();

export const opportunityFields = z.object({
  name: z.string().trim().min(1, "Topic is required").max(200),
  customerAccountId: uuidOrNull,
  customerContactId: uuidOrNull,
  estRevenueCents: z.number().int().min(0).max(1e12).optional(),
  estCloseDate: date,
  probability: z.number().int().min(0).max(100).optional(),
  budgetCents: cents,
  purchaseTimeframe: text(120),
  proposalDelivered: z.boolean().optional(),
});

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const today = () => new Date().toISOString().slice(0, 10);

export const snapshot = (o: Opportunity): OpportunitySnapshot => ({
  name: o.name,
  customerAccountId: o.customerAccountId,
  customerContactId: o.customerContactId,
  estCloseDate: o.estCloseDate,
  estRevenueCents: o.estRevenueCents,
  budgetCents: o.budgetCents,
  purchaseTimeframe: o.purchaseTimeframe,
  proposalDelivered: o.proposalDelivered,
});

export const OPPORTUNITY_VIEWS = [
  { id: "my_open", label: "My Open Opportunities" },
  { id: "open", label: "Open Opportunities" },
  { id: "closing_30", label: "Closing Next 30 Days" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
] as const;
export type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number]["id"];

export async function createOpportunity(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ opportunity: Opportunity }>> {
  if (!can(ctx.subject, "opportunity", "create")) return FORBIDDEN;
  const p = opportunityFields.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(opportunity)
      .values({
        ...p.data,
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        opportunityNumber: await nextNumber(tx, ctx.tenantId, "opportunity"),
      })
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: row!.id,
      action: "create",
    });
    return { ok: true, opportunity: row! };
  });
}

export async function getOpportunity(
  ctx: Ctx,
  id: string,
): Promise<Result<{ opportunity: Opportunity }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx.select().from(opportunity).where(eq(opportunity.id, id));
    return checkRecord(ctx, "opportunity", "read", row) ?? { ok: true, opportunity: row! };
  });
}

export async function listOpportunities(
  ctx: Ctx,
  opts: { view?: OpportunityView; search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: Opportunity[]; total: number }>> {
  const scope = readScope(ctx.subject, "opportunity", opportunity.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  const open = eq(opportunity.status, "open");
  const byView: Record<OpportunityView, SQL | undefined> = {
    my_open: and(open, eq(opportunity.ownerId, ctx.userId)),
    open,
    closing_30: and(
      open,
      sql`${opportunity.estCloseDate} between current_date and current_date + 30`,
    ),
    won: eq(opportunity.status, "won"),
    lost: eq(opportunity.status, "lost"),
  };
  const q = opts.search?.trim();
  const where = and(
    scope.where,
    byView[opts.view ?? "my_open"],
    q ? ilike(opportunity.name, `%${q}%`) : undefined,
  );
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(opportunity)
      .where(where)
      .orderBy(desc(opportunity.createdAt))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(opts.offset ?? 0);
    const [total] = await tx.select({ n: count() }).from(opportunity).where(where);
    return { ok: true, rows, total: total!.n };
  });
}

/** Open opportunities per stage with their count and total estimated revenue (the Kanban board). */
export async function pipeline(ctx: Ctx): Promise<
  Result<{
    stages: { stage: Stage; count: number; estRevenueCents: number; items: Opportunity[] }[];
  }>
> {
  const scope = readScope(ctx.subject, "opportunity", opportunity.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(opportunity)
      .where(and(scope.where, eq(opportunity.status, "open")))
      .orderBy(desc(opportunity.estRevenueCents))
      .limit(500);
    return {
      ok: true,
      stages: STAGES.map((stage) => {
        const items = rows.filter((r) => r.stage === stage);
        return {
          stage,
          count: items.length,
          estRevenueCents: items.reduce((s, r) => s + r.estRevenueCents, 0),
          items,
        };
      }),
    };
  });
}

async function loadOpen(tx: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: Ctx, id: string) {
  const [row] = await tx.select().from(opportunity).where(eq(opportunity.id, id)).for("update");
  const denied = checkRecord(ctx, "opportunity", "write", row);
  if (denied) return { denied };
  return { row: row! };
}

export async function updateOpportunity(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ opportunity: Opportunity }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = opportunityFields.partial().safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, id);
    if (denied) return denied;
    if (row.status !== "open")
      return fail("read_only", `This opportunity is ${row.status}. Reopen it to make changes.`);
    const patch = defined(p.data);
    const changes = diffChanges(row as never, { ...row, ...patch } as never, Object.keys(patch));
    if (Object.keys(changes).length === 0) return { ok: true, opportunity: row };
    const [updated] = await tx
      .update(opportunity)
      .set({ ...patch, modifiedAt: new Date(), modifiedBy: ctx.userId })
      .where(eq(opportunity.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: id,
      action: "update",
      changes,
    });
    return { ok: true, opportunity: updated! };
  });
}

/**
 * Moves an opportunity along the business process flow. Going forward is one stage at a time and
 * only when the current stage's required fields are filled in; the response names what's missing.
 */
export async function moveStage(
  ctx: Ctx,
  id: string,
  target: unknown,
): Promise<Result<{ opportunity: Opportunity }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!isStage(target)) return fail("invalid", "Unknown stage.");
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, id);
    if (denied) return denied;
    if (row.status !== "open")
      return fail("read_only", `This opportunity is ${row.status}. Reopen it to change its stage.`);
    const from = row.stage as Stage;
    const check = canMove(snapshot(row), from, target);
    if (!check.ok) {
      if (check.reason === "missing_fields") {
        return fail(
          "missing_fields",
          `Fill in the required fields before leaving ${from}: ${check.missing!.map((m) => m.label).join(", ")}.`,
          { missing: check.missing },
        );
      }
      return fail(
        "invalid",
        check.reason === "skip"
          ? "Stages must be completed in order."
          : "It's already in that stage.",
      );
    }
    const forward = STAGES.indexOf(target) > STAGES.indexOf(from);
    const [updated] = await tx
      .update(opportunity)
      .set({
        stage: target,
        ...(forward ? { probability: STAGE_PROBABILITY[target] } : {}),
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(opportunity.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: id,
      action: "stage",
      changes: { stage: { from, to: target } },
    });
    return { ok: true, opportunity: updated! };
  });
}

const wonInput = z.object({
  actualRevenueCents: z.number().int().min(0).max(1e12),
  actualCloseDate: date,
  competitor: text(120),
  reason: text(300),
});
const lostInput = z.object({
  reason: z.string().trim().min(1, "Give a reason for losing this opportunity").max(300),
  actualCloseDate: date,
  competitor: text(120),
});

/** Close as Won: records the actual revenue and date, and makes the customer account a Customer. */
export async function closeAsWon(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ opportunity: Opportunity; accountBecameCustomer: boolean }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = wonInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, id);
    if (denied) return denied;
    if (row.status !== "open")
      return fail("read_only", `This opportunity is already ${row.status}.`);
    const [updated] = await tx
      .update(opportunity)
      .set({
        status: "won",
        stage: "close",
        probability: 100,
        actualRevenueCents: p.data.actualRevenueCents,
        actualCloseDate: p.data.actualCloseDate ?? today(),
        competitor: p.data.competitor ?? null,
        closeReason: p.data.reason ?? null,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(opportunity.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: id,
      action: "close_won",
      changes: {
        status: { from: "open", to: "won" },
        actualRevenueCents: p.data.actualRevenueCents,
      },
    });

    // A won deal makes its account a Customer. This is a platform rule, not a permission the
    // salesperson needs on the account record, so it is applied directly.
    let accountBecameCustomer = false;
    if (row.customerAccountId) {
      const flipped = await tx
        .update(account)
        .set({ relationshipType: "customer", modifiedAt: new Date(), modifiedBy: ctx.userId })
        .where(
          and(
            eq(account.id, row.customerAccountId),
            sql`${account.relationshipType} <> 'customer'`,
          ),
        )
        .returning({ id: account.id });
      accountBecameCustomer = flipped.length > 0;
      if (accountBecameCustomer) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entity: "account",
          recordId: row.customerAccountId,
          action: "update",
          changes: {
            relationshipType: { from: "prospect", to: "customer" },
            because: `opportunity ${row.opportunityNumber} won`,
          },
        });
      }
    }
    return { ok: true, opportunity: updated!, accountBecameCustomer };
  });
}

export async function closeAsLost(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ opportunity: Opportunity }>> {
  if (!isUuid(id)) return NOT_FOUND;
  const p = lostInput.safeParse(raw);
  if (!p.success) return invalid(p);
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, id);
    if (denied) return denied;
    if (row.status !== "open")
      return fail("read_only", `This opportunity is already ${row.status}.`);
    const [updated] = await tx
      .update(opportunity)
      .set({
        status: "lost",
        probability: 0,
        closeReason: p.data.reason,
        competitor: p.data.competitor ?? null,
        actualCloseDate: p.data.actualCloseDate ?? today(),
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(opportunity.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: id,
      action: "close_lost",
      changes: { status: { from: "open", to: "lost" }, reason: p.data.reason },
    });
    return { ok: true, opportunity: updated! };
  });
}

export async function reopenOpportunity(
  ctx: Ctx,
  id: string,
): Promise<Result<{ opportunity: Opportunity }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const { row, denied } = await loadOpen(tx, ctx, id);
    if (denied) return denied;
    if (row.status === "open") return fail("conflict", "This opportunity is already open.");
    const [updated] = await tx
      .update(opportunity)
      .set({
        status: "open",
        probability: STAGE_PROBABILITY[row.stage as Stage] ?? 10,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(opportunity.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "opportunity",
      recordId: id,
      action: "reopen",
      changes: { status: { from: row.status, to: "open" } },
    });
    return { ok: true, opportunity: updated! };
  });
}

/** Total estimated revenue of the user's visible open pipeline, in cents. */
export async function openPipelineValue(ctx: Ctx): Promise<number> {
  const scope = readScope(ctx.subject, "opportunity", opportunity.ownerId);
  if (!scope.allowed) return 0;
  return withTenant(ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select({ total: sum(opportunity.estRevenueCents) })
      .from(opportunity)
      .where(and(scope.where, eq(opportunity.status, "open")));
    return Number(r?.total ?? 0);
  });
}
