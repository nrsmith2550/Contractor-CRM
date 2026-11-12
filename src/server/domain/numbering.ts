import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

/**
 * Next auto-number for an entity in this tenant, e.g. LEAD-01001. The single UPDATE takes a row
 * lock on the tenant's sequence row, so concurrent creates are serialised and never collide, and
 * a rolled-back create gives its number back (no gaps). Sequences are seeded at activation.
 */
export async function nextNumber(tx: Tx, tenantId: string, entity: string): Promise<string> {
  const res = await tx.execute<{ prefix: string; n: number }>(sql`
    update "sequence" set next_value = next_value + 1
     where tenant_id = ${tenantId} and entity = ${entity}
    returning prefix, next_value - 1 as n`);
  const row = res.rows[0];
  if (!row) throw new Error(`No numbering sequence for "${entity}" in this tenant`);
  return `${row.prefix}-${String(row.n).padStart(5, "0")}`;
}
