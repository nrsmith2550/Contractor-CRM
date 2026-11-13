import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/shell/Icon";
import { SiteMap } from "@/components/shell/SiteMap";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { requireUser } from "@/server/auth/http";
import { SignOutButton } from "../../(auth)/auth-forms";
import "../../crm.css";

/** Up to two capital letters from a name, for the round avatar. */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

// The app shell: top bar, site map and content area. Every request also re-validates the
// session, user and license, and a forced password change blocks everything else.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div className="crm-shell">
      <a href="#main" className="crm-skip">
        Skip to main content
      </a>
      <header className="crm-topbar">
        <form action="/app/search" method="get" role="search" className="crm-search">
          <Icon name="search" />
          <input
            type="search"
            name="q"
            placeholder="Search prospects, customers, deals…"
            aria-label="Search all records"
          />
        </form>
        <Link href="/app/help" className="crm-btn">
          Help
        </Link>
        <ThemeToggle />
        <span className="crm-avatar" aria-hidden="true">
          {initials(user.fullName)}
        </span>
        <span className="crm-user">{user.fullName}</span>
        <SignOutButton />
      </header>
      <SiteMap />
      <main id="main" tabIndex={-1} className="crm-main">
        {children}
      </main>
    </div>
  );
}
