import Stripe from "stripe";

let client: Stripe | null = null;

/** Whether a secret or restricted key is for test mode or for real money. */
export function keyMode(key: string): "test" | "live" | "unknown" {
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return "unknown";
}

/**
 * Real-money keys are refused unless `STRIPE_ALLOW_LIVE=true` is set on purpose, so a live key
 * pasted into a development or preview environment can never charge anyone by accident.
 */
export function assertKeyAllowed(key: string, allowLive = process.env.STRIPE_ALLOW_LIVE): void {
  if (keyMode(key) === "live" && allowLive !== "true") {
    throw new Error(
      "STRIPE_SECRET_KEY is a live key, but STRIPE_ALLOW_LIVE is not 'true'. Use a test-mode key.",
    );
  }
}

/** Lazily-built Stripe client. Uses fetch, so it also runs on Cloudflare Workers. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  assertKeyAllowed(key);
  return (client ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }));
}

export const isStripeConfigured = (): boolean =>
  Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);

/** "test" while a test-mode key is in use, so screens can say so. */
export function stripeMode(): "test" | "live" | "unknown" {
  return keyMode(process.env.STRIPE_SECRET_KEY ?? "");
}

export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not set");
  return url.replace(/\/$/, "");
}
