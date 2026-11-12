import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { securityRole, userRole } from "@/db/schema";
import { mergePrivileges, type Privileges, type Subject } from "./roles";

/** The signed-in user's combined privileges across all of their roles, for `can()`. */
export async function loadSubject(tenantId: string, userId: string): Promise<Subject> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ privileges: securityRole.privileges })
      .from(userRole)
      .innerJoin(securityRole, eq(userRole.roleId, securityRole.id))
      .where(eq(userRole.userId, userId)),
  );
  return { userId, privileges: mergePrivileges(rows.map((r) => r.privileges as Privileges)) };
}
