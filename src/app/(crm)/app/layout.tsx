import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SiteMap } from "@/components/shell/SiteMap";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
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
        <form action="/app/search" method="get" role="search">
          <input
            type="search"
            name="q"
            placeholder="Search leads, deals, contacts…"
            aria-label="Search all records"
          />
        </form>
        <ThemeToggle />
        <span className="crm-user">{user.fullName}</span>
        <SignOutButton />
      </header>
      <SiteMap />
      <main className="crm-main">{children}</main>
    </div>
  );
}
