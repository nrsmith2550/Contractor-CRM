"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { Icon, type IconName } from "./Icon";

type NavLink = readonly [label: string, href: string, icon: IconName];

const GROUPS: readonly { title: string; links: readonly NavLink[] }[] = [
  {
    title: "",
    links: [["Home", "/app", "home"]],
  },
  {
    title: "My work",
    links: [
      ["Sales dashboard", "/app/dashboards/sales", "chart"],
      ["Service dashboard", "/app/dashboards/service", "chart"],
      ["Calendar", "/app/calendar", "calendar"],
    ],
  },
  {
    title: "Sales",
    links: [
      ["Prospects", "/app/prospects", "target"],
      ["Deals", "/app/deals", "deal"],
      ["Quotes", "/app/quotes", "quote"],
      ["Orders", "/app/orders", "order"],
      ["Pipeline", "/app/pipeline", "funnel"],
    ],
  },
  {
    title: "Service",
    links: [
      ["Support requests", "/app/support-requests", "support"],
      ["Jobs", "/app/jobs", "job"],
      ["Schedule", "/app/schedule", "clock"],
      ["Team members", "/app/team", "team"],
      ["My visits", "/app/my-visits", "pin"],
    ],
  },
  {
    title: "Customers and people",
    links: [
      ["Customers", "/app/customers", "building"],
      ["People", "/app/people", "person"],
    ],
  },
  {
    title: "Products and pricing",
    links: [
      ["Products and services", "/app/products", "tag"],
      ["Pricing", "/app/pricing", "list"],
    ],
  },
  {
    title: "Help",
    links: [["Help guide", "/app/help", "help"]],
  },
  {
    title: "Settings",
    links: [
      ["Users", "/app/settings/users", "team"],
      ["Tax rates", "/app/settings/tax-rates", "settings"],
      ["Branding", "/app/settings/branding", "settings"],
      ["Service settings", "/app/settings/service", "settings"],
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
        <div key={g.title || "home"}>
          {g.title && <h2>{g.title}</h2>}
          {g.links.map(([label, href, icon]) => {
            const active =
              href === "/app" ? path === href : path === href || path.startsWith(`${href}/`);
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}>
                <Icon name={icon} />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
