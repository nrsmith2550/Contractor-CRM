import { withPlatform, type Tx } from "@/db/client";
import { adminAuditLog } from "@/db/schema";

export type AuditEntry = {
  adminId: string | null;
  action: string;
  targetType: string;
  targetId?: string;
  reason?: string;
  ip?: string;
};

/**
 * Writes an immutable `admin_audit_log` row (who, what, when, from where, why). The table is
 * append-only for the app role, so entries cannot be edited or removed afterwards. Pass the
 * caller's transaction so the entry commits or rolls back together with the action itself.
 */
export async function writeAdminAudit(entry: AuditEntry, tx?: Tx): Promise<void> {
  const run = (t: Tx) =>
    t.insert(adminAuditLog).values({
      adminId: entry.adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      reason: entry.reason,
      ip: entry.ip,
    });
  await (tx ? run(tx) : withPlatform(run));
}
