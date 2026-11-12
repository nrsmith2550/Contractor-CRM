import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { withPlatform } from "@/db/client";
import { tenant } from "@/db/schema";
import { requireUser } from "@/server/auth/http";

export const metadata: Metadata = { title: "Sales Hub" };

export default async function SalesHubPage() {
  const user = await requireUser();
  const [t] = await withPlatform((tx) =>
    tx.select({ name: tenant.name }).from(tenant).where(eq(tenant.id, user.tenantId)),
  );
  return (
    <main style={{ padding: 24 }}>
      <h1>Sales Hub</h1>
      <p>
        Welcome, {user.fullName}. You&apos;re signed in to <strong>{t?.name}</strong>.
      </p>
      <p>The dashboard, leads, opportunities and the rest of the app arrive in the next phases.</p>
    </main>
  );
}
