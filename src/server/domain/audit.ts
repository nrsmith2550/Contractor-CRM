import type { Tx } from "@/db/client";
import { auditLog } from "@/db/schema";

export type Changes = Record<string, { from: unknown; to: unknown }>;

const norm = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : (v ?? null));

/** Field-level before/after, only for fields whose value actually changed. */
export function diffChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: string[],
): Changes {
  const out: Changes = {};
  for (const key of fields ?? Object.keys(after)) {
    const a = norm(before[key]);
    const b = norm(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[key] = { from: a, to: b };
  }
  return out;
}

/** One audit row per create/update/delete/workflow action, in the caller's transaction. */
export async function recordAudit(
  tx: Tx,
  entry: {
    tenantId: string;
    userId: string;
    entity: string;
    recordId: string;
    action: string;
    changes?: Changes | Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId: entry.tenantId,
    userId: entry.userId,
    entity: entry.entity,
    recordId: entry.recordId,
    action: entry.action,
    changes: entry.changes ?? null,
  });
}
