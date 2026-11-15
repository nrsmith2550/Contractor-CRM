import type Stripe from "stripe";
import { PLANS, isEdition, isValidExtraUsers, type Edition } from "@/lib/plans";

/**
 * What a purchase is made of, in Stripe's terms. Prices are sent inline (`price_data`) from
 * lib/plans.ts, so nothing has to be created in the Stripe dashboard first and the code stays the
 * single source of truth for prices.
 *
 * A purchase is one subscription with up to three lines:
 *   1. the plan, every month;
 *   2. the extra people, every month (left out when there are none);
 *   3. the one-time setup fee, charged on the first invoice only.
 * `metadata` on the session and on the subscription records what was bought, and the subscription's
 * copy is what later changes (more people, a different plan) keep up to date.
 */
export type PurchaseChoice = { edition: Edition; extraUsers: number };

export const metadataFor = (c: PurchaseChoice) => ({
  kind: "subscription",
  edition: c.edition,
  extraUsers: String(c.extraUsers),
});

/** What a subscription was bought as, read back from the metadata we put on it. */
export function choiceFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): PurchaseChoice | null {
  const edition = metadata?.edition;
  const extra = Number(metadata?.extraUsers);
  if (!isEdition(edition) || !isValidExtraUsers(extra)) return null;
  return { edition, extraUsers: extra };
}

/** The lines for a new subscription. Exported so tests can check the money exactly. */
export function purchaseLineItems(
  c: PurchaseChoice,
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  const plan = PLANS[c.edition];
  const monthly = (name: string, unit: number, role: string) => ({
    currency: "usd",
    unit_amount: unit,
    recurring: { interval: "month" as const },
    product_data: { name, metadata: { role, edition: c.edition } },
  });
  return [
    { quantity: 1, price_data: monthly(`${plan.name}, monthly`, plan.monthlyCents, "plan") },
    ...(c.extraUsers > 0
      ? [
          {
            quantity: c.extraUsers,
            price_data: monthly("Extra people, monthly", plan.extraUserCents, "seats"),
          },
        ]
      : []),
    {
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: plan.setupCents,
        product_data: { name: `${plan.name}, one-time setup`, metadata: { role: "setup" } },
      },
    },
  ];
}

/**
 * Starts a purchase that is paid for on our own page: Stripe's checkout form is embedded in it
 * (`ui_mode: embedded_page`), so the buyer never leaves the site. `redirect_on_completion: never`
 * means no return address is needed; the page shows its own thank-you when the form says it is done.
 * Returns the client secret the browser needs to show the form (it is not a secret key).
 */
export async function createSubscriptionCheckout(
  stripe: Pick<Stripe, "checkout">,
  choice: unknown,
): Promise<string> {
  const c = choice as Partial<PurchaseChoice> | null;
  if (!c || !isEdition(c.edition) || !isValidExtraUsers(c.extraUsers)) {
    throw new Error("Invalid purchase");
  }
  const clean: PurchaseChoice = { edition: c.edition, extraUsers: c.extraUsers };
  const metadata = metadataFor(clean);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    ui_mode: "embedded_page",
    redirect_on_completion: "never",
    // Shows an "Add promotion code" box. Codes and their rules (amount, uses, expiry) are made in
    // the Stripe dashboard; nothing is discounted unless a valid code is entered.
    allow_promotion_codes: true,
    line_items: purchaseLineItems(clean),
    metadata,
    subscription_data: { metadata },
  });
  if (!session.client_secret) throw new Error("Stripe did not return a checkout client secret");
  return session.client_secret;
}
