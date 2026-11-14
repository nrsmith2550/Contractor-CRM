import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { securityRole, userRole } from "@/db/schema";
import { limitToEdition } from "@/lib/plans";
import { tenantEdition } from "@/server/entities/tenant";
import { mergePrivileges, type Privileges, type Subject } from "./roles";

/**
 * The signed-in user's combined privileges across all of their roles, for `can()`. The business's
 * plan is applied here: anything the plan does not include is removed, so every check in the app
 * (screens, lists, server actions, exports) follows the licence without each one knowing about it.
 */
export async function loadSubject(tenantId: string, userId: string): Promise<Subject> {
  const [rows, edition] = await Promise.all([
    withTenant(tenantId, (tx) =>
      tx
        .select({ privileges: securityRole.privileges })
        .from(userRole)
        .innerJoin(securityRole, eq(userRole.roleId, securityRole.id))
        .where(eq(userRole.userId, userId)),
    ),
    tenantEdition(tenantId),
  ]);
  const merged = mergePrivileges(rows.map((r) => r.privileges as Privileges));
  return { userId, privileges: limitToEdition(merged, edition), edition };
}
