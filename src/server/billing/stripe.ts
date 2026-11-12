import Stripe from "stripe";

let client: Stripe | null = null;

/** Lazily-built Stripe client. Uses fetch, so it also runs on Cloudflare Workers. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return (client ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }));
}

export const isStripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

export function appUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not set");
  return url.replace(/\/$/, "");
}
