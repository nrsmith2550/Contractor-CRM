"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";
import { hasArea, type Area, type Edition } from "@/lib/plans";
import { Icon, type IconName } from "./Icon";

/** A link, and the part of the product it belongs to (none = in every plan). */
type NavLink = readonly [label: string, href: string, icon: IconName, area?: Area];

const GROUPS: readonly { title: string; links: readonly NavLink[] }[] = [
  {
    title: "",
    links: [["Home", "/app", "home"]],
  },
  {
    title: "My work",
    links: [
      ["Deals dashboard", "/app/dashboards/deals", "chart", "deals"],
      ["Jobs dashboard", "/app/dashboards/jobs", "chart", "jobs"],
      ["Calendar", "/app/calendar", "calendar"],
    ],
  },
  {
    title: "Gantry Deals",
    links: [
      ["Prospects", "/app/prospects", "target", "deals"],
      ["Deals", "/app/deals", "deal", "deals"],
      ["Quotes", "/app/quotes", "quote", "deals"],
      ["Orders", "/app/orders", "order", "deals"],
      ["Pipeline", "/app/pipeline", "funnel", "deals"],
    ],
  },
  {
    title: "Gantry Jobs",
    links: [
      ["Support requests", "/app/support-requests", "support", "jobs"],
      ["Jobs", "/app/jobs", "job", "jobs"],
      ["Schedule", "/app/schedule", "clock", "jobs"],
      ["Team members", "/app/team", "team", "jobs"],
      ["My visits", "/app/my-visits", "pin", "jobs"],
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
      ["Your plan", "/app/plan", "list"],
      ["Billing", "/app/settings/billing", "settings"],
      ["Job settings", "/app/settings/jobs", "settings", "jobs"],
    ],
  },
] as const;

export function SiteMap({ edition, showBilling }: { edition: Edition; showBilling: boolean }) {
  const path = usePathname();
  return (
    <nav className="crm-sitemap" aria-label="Site map">
      <Link href="/app" className="crm-brand" aria-label="Gantry CRM home">
        <Brand alt="" />
      </Link>
      {GROUPS.map((g) => ({
        ...g,
        links: g.links.filter(
          ([, href, , area]) =>
            (!area || hasArea(edition, area)) && (showBilling || href !== "/app/settings/billing"),
        ),
      }))
        .filter((g) => g.links.length > 0)
        .map((g) => (
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
