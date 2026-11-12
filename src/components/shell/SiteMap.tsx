"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const GROUPS = [
  {
    title: "Sales",
    links: [
      ["Dashboard", "/app"],
      ["Leads", "/app/leads"],
      ["Opportunities", "/app/opportunities"],
      ["Pipeline", "/app/pipeline"],
    ],
  },
  {
    title: "Customers",
    links: [
      ["Accounts", "/app/accounts"],
      ["Contacts", "/app/contacts"],
    ],
  },
  { title: "Settings", links: [["Users", "/app/settings/users"]] },
] as const;

export function SiteMap() {
  const path = usePathname();
  return (
    <nav className="crm-sitemap" aria-label="Site map">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h2>{g.title}</h2>
          {g.links.map(([label, href]) => {
            const active =
              href === "/app" ? path === href : path === href || path.startsWith(`${href}/`);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}>
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
