import type Stripe from "stripe";
import { TIERS, upgradePriceCents, type Tier } from "@/lib/tiers";

/**
 * Prices are sent inline (`price_data`) from lib/tiers.ts, so nothing has to be created in the
 * Stripe dashboard first and the code stays the single source of truth for prices.
 * Both flows are one-time payments (`mode: "payment"`), never subscriptions.
 */

/** Public purchase: buyer picks a tier on /pricing and pays once. Returns the hosted URL. */
export async function createPurchaseCheckout(
  stripe: Pick<Stripe, "checkout">,
  args: { tier: Tier; appUrl: string },
): Promise<string> {
  const tier = TIERS[args.tier];
  const metadata = { kind: "purchase", tier: args.tier };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_creation: "always",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: tier.priceCents,
          product_data: {
            name: `CRM ${tier.label} license`,
            description: `One-time perpetual license, ${tier.seats}`,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${args.appUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${args.appUrl}/pricing`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/**
 * Owner-initiated upgrade (Settings → License): pays only the price difference between
 * tiers. The webhook then raises the seat limit on the same license; no new key.
 */
export async function createUpgradeCheckout(
  stripe: Pick<Stripe, "checkout">,
  args: {
    licenseId: string;
    fromTier: Tier;
    toTier: Tier;
    stripeCustomerId?: string | null;
    appUrl: string;
  },
): Promise<string> {
  const amount = upgradePriceCents(args.fromTier, args.toTier); // throws on a non-upgrade
  const to = TIERS[args.toTier];
  const metadata = { kind: "upgrade", licenseId: args.licenseId, toTier: args.toTier };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    ...(args.stripeCustomerId
      ? { customer: args.stripeCustomerId }
      : { customer_creation: "always" as const }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: `Upgrade to CRM ${to.label}`,
            description: `Raises your limit to ${to.seatLimit} active users`,
          },
        },
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: `${args.appUrl}/app/settings/license?upgraded=1`,
    cancel_url: `${args.appUrl}/app/settings/license`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}
