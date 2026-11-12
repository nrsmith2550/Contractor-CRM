import { withPlatform, type Tx } from "@/db/client";
import { license } from "@/db/schema";
import {
  generateLicenseKey,
  hashLicenseKey,
  licenseKeyLast5,
  normalizeLicenseKey,
} from "@/server/auth/license-key";

import { TIERS, type Tier } from "@/lib/tiers";

export { TIERS, upgradePriceCents, type Tier } from "@/lib/tiers";

export type MintArgs = {
  tier: Tier;
  buyerEmail?: string;
  amountPaidCents?: number;
  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  /** Override for custom quotes (over 100 users) minted by the platform admin. */
  seatLimit?: number;
};

export type Minted = { key: string; licenseId: string; last5: string };

/**
 * Creates an `issued` license and returns the full key, which exists only in this return
 * value: show it once and email it. Only its hash is stored.
 *
 * If `args.stripePaymentIntentId` already has a license, nothing is created and `null` is
 * returned, so a repeated payment event can never mint a second key.
 */
export async function mintLicense(args: MintArgs, tx?: Tx): Promise<Minted>;
export async function mintLicense(
  args: MintArgs & { stripePaymentIntentId: string },
  tx?: Tx,
): Promise<Minted | null>;
export async function mintLicense(args: MintArgs, tx?: Tx): Promise<Minted | null> {
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
      .onConflictDoNothing({ target: license.stripePaymentIntentId })
      .returning({ id: license.id });
    return row?.id ?? null;
  };
  const licenseId = tx ? await run(tx) : await withPlatform(run);
  if (!licenseId) return null;
  return { key, licenseId, last5: licenseKeyLast5(normalized) };
}
