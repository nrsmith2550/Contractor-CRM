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
      ["Quotes", "/app/quotes"],
      ["Orders", "/app/orders"],
      ["Pipeline", "/app/pipeline"],
    ],
  },
  {
    title: "Service",
    links: [
      ["Cases", "/app/cases"],
      ["Work orders", "/app/work-orders"],
    ],
  },
  {
    title: "Customers",
    links: [
      ["Accounts", "/app/accounts"],
      ["Contacts", "/app/contacts"],
    ],
  },
  {
    title: "Collateral",
    links: [
      ["Products", "/app/products"],
      ["Price lists", "/app/price-lists"],
    ],
  },
  {
    title: "Settings",
    links: [
      ["Users", "/app/settings/users"],
      ["Tax rates", "/app/settings/tax-rates"],
      ["Branding", "/app/settings/branding"],
      ["Service settings", "/app/settings/service"],
    ],
  },
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
