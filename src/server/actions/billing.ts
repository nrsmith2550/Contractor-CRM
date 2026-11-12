"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { TIER_IDS } from "@/lib/tiers";
import { createPurchaseCheckout } from "@/server/billing/checkout";
import { appUrl, getStripe, isStripeConfigured } from "@/server/billing/stripe";

const TierInput = z.enum(TIER_IDS);

/** /pricing "Buy" button: validates the tier, creates a Checkout session, redirects to Stripe. */
export async function startCheckout(formData: FormData): Promise<void> {
  const parsed = TierInput.safeParse(formData.get("tier"));
  if (!parsed.success) redirect("/pricing?error=invalid");
  if (!isStripeConfigured()) redirect("/pricing?error=unavailable");

  const url = await createPurchaseCheckout(getStripe(), { tier: parsed.data, appUrl: appUrl() });
  redirect(url);
}
