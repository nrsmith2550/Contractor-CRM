// The plain-language names the product uses on screen. This is the ONE place they are defined,
// so renaming a thing (or later, offering an industry's own words: Estimate instead of Quote,
// Crew instead of Team member) is a change here, not a hunt through the app.
//
// Only what people READ changes. Database tables, code identifiers and permissions keep their
// internal names (lead, account, work_order, ...), and the login "account" (a person's sign-in)
// is a different thing from a Customer and is not renamed.

export type Term = { one: string; many: string };

export const WORDS = {
  lead: { one: "Prospect", many: "Prospects" },
  account: { one: "Customer", many: "Customers" },
  contact: { one: "Person", many: "People" },
  opportunity: { one: "Deal", many: "Deals" },
  product: { one: "Product or service", many: "Products and services" },
  priceList: { one: "Pricing list", many: "Pricing" },
  case: { one: "Support request", many: "Support requests" },
  workOrder: { one: "Job", many: "Jobs" },
  resource: { one: "Team member", many: "Team members" },
  booking: { one: "Visit", many: "Visits" },
  schedule: { one: "Schedule", many: "Schedule" },
  progressBar: { one: "Progress bar", many: "Progress bars" },
} as const satisfies Record<string, Term>;

/** The same word in running text: "support request", "pricing list". */
export const lc = (s: string): string => s.toLowerCase();

/** Record-number prefixes for new businesses: PROS-01001, CUST-01001, JOB-01001 ... */
export const NUMBER_PREFIXES = {
  lead: "PROS",
  account: "CUST",
  contact: "PERS",
  opportunity: "DEAL",
  case: "REQ",
  work_order: "JOB",
} as const;

/**
 * How stored values read on screen. Everything not listed here is simply the value with
 * underscores as spaces and a capital letter ("in_progress" -> "In progress").
 */
const VALUE_LABELS: Record<string, string> = {
  // Prospect statuses
  qualified: "Turned into a customer",
  disqualified: "Closed",
  // A customer record's relationship to the business
  prospect: "Potential customer",
  customer: "Current customer",
};

export const humanize = (v: string): string =>
  VALUE_LABELS[v] ?? v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A stored value as it reads inside a sentence: "in_progress" -> "in progress", "qualified" -> "already a customer". */
const SAY: Record<string, string> = {
  qualified: "already a customer",
  disqualified: "closed",
};
export const say = (v: string): string => SAY[v] ?? v.replace(/_/g, " ");
