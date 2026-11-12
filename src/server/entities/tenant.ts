import { eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { tenant } from "@/db/schema";

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
