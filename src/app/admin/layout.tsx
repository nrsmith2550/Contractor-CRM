import type { Metadata } from "next";
import type { ReactNode } from "react";
import { assertAdminAccess } from "@/server/admin/http";

// Never indexed, and a caller outside the optional IP allowlist gets a plain 404.
export const metadata: Metadata = {
  title: { default: "Platform admin", template: "%s · Platform admin" },
  robots: { index: false, follow: false },
};

export default async function AdminRootLayout({ children }: { children: ReactNode }) {
  await assertAdminAccess();
  return <>{children}</>;
}
