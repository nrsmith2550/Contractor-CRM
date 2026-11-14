// Plans: what a business has bought, and so which parts of Clinch it may use. Pure data and
// arithmetic only, so it is safe to import from client components and from the public pages.
//
// Billing is a one-off setup fee plus a monthly fee. Nothing here takes a payment: it is the single
// place the prices and the contents of each plan are written down, so change them here only.

export const EDITIONS = ["complete", "deals", "jobs"] as const;
export type Edition = (typeof EDITIONS)[number];

/** The two halves of the product. Shared things (customers, people, products, the calendar) belong to every plan. */
export const AREAS = ["deals", "jobs"] as const;
export type Area = (typeof AREAS)[number];

/** Every plan includes this many people signing in. A licence can carry a different number. */
export const USERS_INCLUDED = 10;

export type Plan = {
  id: Edition;
  /** What it is called everywhere: on licences, the pricing page and the menu. */
  name: string;
  /** One line, for the pricing card. */
  tagline: string;
  setupCents: number;
  monthlyCents: number;
  areas: readonly Area[];
};

export const PLANS: Record<Edition, Plan> = {
  complete: {
    id: "complete",
    name: "Clinch Complete",
    tagline: "Win the work and run the work, in one place.",
    setupCents: 50_000,
    monthlyCents: 7_000,
    areas: ["deals", "jobs"],
  },
  deals: {
    id: "deals",
    name: "Clinch Deals",
    tagline: "From first enquiry to a signed-off quote and order.",
    setupCents: 30_000,
    monthlyCents: 4_500,
    areas: ["deals"],
  },
  jobs: {
    id: "jobs",
    name: "Clinch Jobs",
    tagline: "Support requests, jobs, visits and the schedule.",
    setupCents: 30_000,
    monthlyCents: 4_500,
    areas: ["jobs"],
  },
};

/** What each area covers, in the words people use. Drives the pricing page and the plan screen. */
export const AREA_CONTENT: Record<Area, { name: string; covers: string[] }> = {
  deals: {
    name: "Deals",
    covers: ["Prospects", "Deals and the pipeline", "Quotes with PDF and email", "Orders"],
  },
  jobs: {
    name: "Jobs",
    covers: ["Support requests with due times", "Jobs", "Visits and the schedule", "My visits"],
  },
};

/** What every plan includes, whichever area it covers. */
export const SHARED_CONTENT = [
  "Customers and people",
  "Products and services, pricing and tax",
  "Notes, calls, tasks and the calendar",
  "Reports and dashboards",
  "Import and export",
  "Roles and permissions",
  "The help guide",
];

export function isEdition(value: unknown): value is Edition {
  return typeof value === "string" && (EDITIONS as readonly string[]).includes(value);
}

export function hasArea(edition: Edition, area: Area): boolean {
  return PLANS[edition].areas.includes(area);
}

/** The area an entity belongs to, if it belongs to one. Everything else is shared by every plan. */
export const ENTITY_AREA: Readonly<Record<string, Area>> = {
  lead: "deals",
  opportunity: "deals",
  quote: "deals",
  order: "deals",
  case: "jobs",
  work_order: "jobs",
  booking: "jobs",
};

/** True when this plan may use the entity at all. */
export function editionAllowsEntity(edition: Edition, entity: string): boolean {
  const area = ENTITY_AREA[entity];
  return area === undefined || hasArea(edition, area);
}

/**
 * Takes away the privileges for the parts a plan does not include. Applied wherever a person's
 * privileges are loaded, so every check (screens, server actions, lists, exports) follows it.
 */
export function limitToEdition<T extends Record<string, unknown>>(
  privileges: T,
  edition: Edition,
): T {
  const out: Record<string, unknown> = {};
  for (const [entity, grant] of Object.entries(privileges)) {
    if (editionAllowsEntity(edition, entity)) out[entity] = grant;
  }
  return out as T;
}

export function formatPlanUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** The cost of the first year: setup plus twelve months. For the "what will it cost me" line. */
export function firstYearCents(edition: Edition): number {
  const p = PLANS[edition];
  return p.setupCents + 12 * p.monthlyCents;
}
