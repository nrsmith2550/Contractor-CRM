"use server";

import { z } from "zod";
import { EDITIONS, MAX_EXTRA_USERS } from "@/lib/plans";
import { requestContext } from "@/server/auth/http";
import { hitRateLimit } from "@/server/auth/rate-limit";
import { createSubscriptionCheckout } from "@/server/billing/checkout";
import { getStripe, isStripeConfigured } from "@/server/billing/stripe";

const Input = z.object({
  edition: z.enum(EDITIONS),
  extraUsers: z.number().int().min(0).max(MAX_EXTRA_USERS),
});

export type CheckoutStart =
  | { ok: true; clientSecret: string }
  | { ok: false; error: "invalid" | "unavailable" | "busy" | "failed" };

/**
 * Starts an on-site checkout for the plan and number of people chosen. Returns the client secret
 * the page needs to show the payment form inside Gantry, so nobody is sent away to Stripe.
 * The price is never taken from the browser: it is rebuilt here from the plan table.
 */
export async function createCheckoutSessionAction(input: unknown): Promise<CheckoutStart> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!isStripeConfigured()) return { ok: false, error: "unavailable" };

  const { ip } = await requestContext();
  const limit = await hitRateLimit(`checkout:${ip}`, { max: 20, windowSeconds: 3600 });
  if (!limit.allowed) return { ok: false, error: "busy" };

  try {
    const clientSecret = await createSubscriptionCheckout(getStripe(), parsed.data);
    return { ok: true, clientSecret };
  } catch (err) {
    console.error("checkout session failed", err instanceof Error ? err.message : "unknown");
    return { ok: false, error: "failed" };
  }
}
