"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";

const GROUPS = [
  {
    title: "My work",
    links: [
      ["Sales dashboard", "/app/dashboards/sales"],
      ["Service dashboard", "/app/dashboards/service"],
      ["Calendar", "/app/calendar"],
    ],
  },
  {
    title: "Sales",
    links: [
      ["Dashboard", "/app"],
      ["Prospects", "/app/prospects"],
      ["Deals", "/app/deals"],
      ["Quotes", "/app/quotes"],
      ["Orders", "/app/orders"],
      ["Pipeline", "/app/pipeline"],
    ],
  },
  {
    title: "Service",
    links: [
      ["Support requests", "/app/support-requests"],
      ["Jobs", "/app/jobs"],
      ["Schedule", "/app/schedule"],
      ["Team members", "/app/team"],
      ["My visits", "/app/my-visits"],
    ],
  },
  {
    title: "Customers and people",
    links: [
      ["Customers", "/app/customers"],
      ["People", "/app/people"],
    ],
  },
  {
    title: "Products and pricing",
    links: [
      ["Products and services", "/app/products"],
      ["Pricing", "/app/pricing"],
    ],
  },
  {
    title: "Help",
    links: [["Help guide", "/app/help"]],
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
      <Link href="/app" className="crm-brand" aria-label="Clinch CRM home">
        <Brand alt="" />
      </Link>
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
