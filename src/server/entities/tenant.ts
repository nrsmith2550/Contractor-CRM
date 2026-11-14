import { and, desc, eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { license, tenant } from "@/db/schema";
import type { Edition } from "@/lib/plans";

/** The tenant's display time zone (timestamps are stored in UTC). */
export async function tenantTimeZone(tenantId: string): Promise<string> {
  const [t] = await withPlatform((tx) =>
    tx.select({ tz: tenant.timeZone }).from(tenant).where(eq(tenant.id, tenantId)),
  );
  return t?.tz ?? "UTC";
}

export async function tenantName(tenantId: string): Promise<string> {
  const [t] = await withPlatform((tx) =>
    tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, tenantId)),
  );
  return t?.name ?? "";
}

/**
 * What the business has bought: the full suite, or just Deals or just Jobs. It comes from its
 * active licence. A business with no active licence cannot be signed in at all, so the fallback
 * only ever applies to code that runs before activation completes.
 */
export async function tenantEdition(tenantId: string): Promise<Edition> {
  const [l] = await withPlatform((tx) =>
    tx
      .select({ edition: license.edition })
      .from(license)
      .where(and(eq(license.tenantId, tenantId), eq(license.status, "active")))
      .orderBy(desc(license.activatedAt))
      .limit(1),
  );
  return l?.edition ?? "complete";
}
