import { eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { tenant } from "@/db/schema";

/** The business's display details, used on documents and emails. */
export async function getCompany(tenantId: string) {
  const [t] = await withPlatform((tx) =>
    tx
      .select({
        name: tenant.name,
        logo: tenant.logoUrl,
        currency: tenant.currency,
        tz: tenant.timeZone,
      })
      .from(tenant)
      .where(eq(tenant.id, tenantId)),
  );
  return {
    name: t?.name ?? "",
    logo: t?.logo ?? null,
    currency: t?.currency ?? "USD",
    timeZone: t?.tz ?? "UTC",
  };
}
