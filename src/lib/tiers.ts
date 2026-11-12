// Pure data and arithmetic only: safe to import from client components.

export const TIER_IDS = ["starter", "team", "business", "enterprise"] as const;
export type Tier = (typeof TIER_IDS)[number];

/**
 * One-time prices in cents, priced by active users (seats). Placeholders until the pricing
 * decision in docs/PLAN.md is confirmed; change them here and everything follows.
 */
export const TIERS: Record<
  Tier,
  { seatLimit: number; priceCents: number; label: string; seats: string }
> = {
  starter: { seatLimit: 5, priceCents: 49_900, label: "Starter", seats: "1–5 users" },
  team: { seatLimit: 15, priceCents: 129_900, label: "Team", seats: "6–15 users" },
  business: { seatLimit: 40, priceCents: 299_900, label: "Business", seats: "16–40 users" },
  enterprise: { seatLimit: 100, priceCents: 599_900, label: "Enterprise", seats: "41–100 users" },
};

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIER_IDS as readonly string[]).includes(value);
}

/** Price to move from one tier to a larger one: the difference, in cents. */
export function upgradePriceCents(from: Tier, to: Tier): number {
  const diff = TIERS[to].priceCents - TIERS[from].priceCents;
  if (diff <= 0) throw new Error("Upgrades must move to a larger tier");
  return diff;
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
