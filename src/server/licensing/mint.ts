import { withPlatform, type Tx } from "@/db/client";
import { license } from "@/db/schema";
import {
  generateLicenseKey,
  hashLicenseKey,
  licenseKeyLast5,
  normalizeLicenseKey,
} from "@/server/auth/license-key";

export type Tier = "starter" | "team" | "business" | "enterprise";

/** One-time prices in cents and seat limits. Placeholders until the pricing decision is made. */
export const TIERS: Record<Tier, { seatLimit: number; priceCents: number; label: string }> = {
  starter: { seatLimit: 5, priceCents: 49_900, label: "Starter (1–5 users)" },
  team: { seatLimit: 15, priceCents: 129_900, label: "Team (6–15 users)" },
  business: { seatLimit: 40, priceCents: 299_900, label: "Business (16–40 users)" },
  enterprise: { seatLimit: 100, priceCents: 599_900, label: "Enterprise (41–100 users)" },
};

export type MintArgs = {
  tier: Tier;
  buyerEmail?: string;
  amountPaidCents?: number;
  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  /** Override for custom quotes (over 100 users) minted by the platform admin. */
  seatLimit?: number;
};

/**
 * Creates an `issued` license and returns the full key, which exists only in this return
 * value: show it once and email it. Only its hash is stored.
 */
export async function mintLicense(
  args: MintArgs,
  tx?: Tx,
): Promise<{ key: string; licenseId: string; last5: string }> {
  const key = generateLicenseKey();
  const normalized = normalizeLicenseKey(key)!;
  const run = async (t: Tx) => {
    const [row] = await t
      .insert(license)
      .values({
        keyHash: hashLicenseKey(normalized),
        keyLast5: licenseKeyLast5(normalized),
        tier: args.tier,
        seatLimit: args.seatLimit ?? TIERS[args.tier].seatLimit,
        amountPaidCents: args.amountPaidCents ?? 0,
        buyerEmail: args.buyerEmail?.toLowerCase(),
        stripeCustomerId: args.stripeCustomerId,
        stripePaymentIntentId: args.stripePaymentIntentId,
      })
      .returning({ id: license.id });
    return row!.id;
  };
  const licenseId = tx ? await run(tx) : await withPlatform(run);
  return { key, licenseId, last5: licenseKeyLast5(normalized) };
}
