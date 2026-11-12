import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SiteMap } from "@/components/shell/SiteMap";
import { requireUser } from "@/server/auth/http";
import { SignOutButton } from "../../(auth)/auth-forms";
import "../../crm.css";

// The app shell: top bar, site map and content area. Every request also re-validates the
// session, user and license, and a forced password change blocks everything else.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div className="crm-shell">
      <header className="crm-topbar">
        <Link href="/app">
          <strong>CRM</strong> · Sales Hub
        </Link>
        <span className="crm-row">
          <form action="/app/search" method="get" role="search">
            <input type="search" name="q" placeholder="Search" aria-label="Search all records" />
          </form>
          <span>{user.fullName}</span>
          <SignOutButton />
        </span>
      </header>
      <SiteMap />
      <main className="crm-main">{children}</main>
    </div>
  );
}
