// Plans: what a business has bought, and so which parts of Gantry it may use. Pure data and
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

/**
 * The most people a business can have by buying on the site. More than this is a custom quote
 * (the admin console can set any limit), so the price is agreed rather than read off a page.
 */
export const MAX_SELF_SERVE_USERS = 50;

/** How many extra people (beyond the ones included) can be added when buying on the site. */
export const MAX_EXTRA_USERS = MAX_SELF_SERVE_USERS - USERS_INCLUDED;

export type Plan = {
  id: Edition;
  /** What it is called everywhere: on licences, the pricing page and the menu. */
  name: string;
  /** One line, for the pricing card. */
  tagline: string;
  setupCents: number;
  monthlyCents: number;
  /**
   * What each extra person costs per month once a business has more than the included users. There
   * is no setup fee for extra people. Always less than the plan's own rate per person, so growing
   * is rewarded, and for Complete always less than the two single-area prices together, so the
   * suite stays the better deal at every size.
   */
  extraUserCents: number;
  areas: readonly Area[];
};

export const PLANS: Record<Edition, Plan> = {
  complete: {
    id: "complete",
    name: "Gantry Complete",
    tagline: "Win the work and run the work, in one place.",
    setupCents: 50_000,
    monthlyCents: 7_000,
    extraUserCents: 500,
    areas: ["deals", "jobs"],
  },
  deals: {
    id: "deals",
    name: "Gantry Deals",
    tagline: "From first enquiry to a signed-off quote and order.",
    setupCents: 30_000,
    monthlyCents: 4_500,
    extraUserCents: 300,
    areas: ["deals"],
  },
  jobs: {
    id: "jobs",
    name: "Gantry Jobs",
    tagline: "Support requests, jobs, visits and the schedule.",
    setupCents: 30_000,
    monthlyCents: 4_500,
    extraUserCents: 300,
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

/** True for a whole number of extra people that can be bought on the site (0 up to the cap). */
export function isValidExtraUsers(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_EXTRA_USERS;
}

/** The number of people who can sign in, for a plan with this many extra people added. */
export function seatsFor(extraUsers: number): number {
  return USERS_INCLUDED + extraUsers;
}

/** The monthly price of a plan with extra people added. */
export function monthlyCentsFor(edition: Edition, extraUsers = 0): number {
  return PLANS[edition].monthlyCents + extraUsers * PLANS[edition].extraUserCents;
}

/** Extra people needed to cover this many people in total (never negative). */
export function extraUsersFor(totalUsers: number): number {
  return Math.max(0, totalUsers - USERS_INCLUDED);
}

/** What is charged on the first invoice: the one-time setup fee plus the first month. */
export function dueTodayCents(edition: Edition, extraUsers = 0): number {
  return PLANS[edition].setupCents + monthlyCentsFor(edition, extraUsers);
}
