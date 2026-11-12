import Link from "next/link";
import type { ReactNode } from "react";
import { adminLogoutAction } from "@/server/actions/admin";
import { requireAdmin } from "@/server/admin/http";

// Every console request: IP allowlist, then a session that completed the second factor.
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const link = { color: "#fff" } as const;
  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: "#201f1e",
          color: "#fff",
        }}
      >
        <nav style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <strong>Platform admin</strong>
          <a href="/admin" style={link}>
            Overview
          </a>
          <a href="/admin/licenses" style={link}>
            Licenses
          </a>
          <Link href="/admin/tenants" style={link}>
            Businesses
          </Link>
          <a href="/admin/audit" style={link}>
            Audit log
          </a>
        </nav>
        <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span>{admin.admin.email}</span>
          <form action={adminLogoutAction}>
            <button type="submit">Sign out</button>
          </form>
        </span>
      </header>
      <div style={{ padding: 24 }}>{children}</div>
    </div>
  );
}
