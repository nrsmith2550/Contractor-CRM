import Stripe from "stripe";
import { handleStripeEvent } from "@/server/billing/webhook";

export const dynamic = "force-dynamic";

/**
 * Stripe → us. The signature (HMAC over the raw body, with a timestamp tolerance) is the
 * authentication: nothing in the body is trusted until it verifies. Responses:
 *   400 bad/missing signature (Stripe will not retry a malformed request meaningfully)
 *   500 we failed to apply a valid event (Stripe retries with backoff; handling is idempotent)
 *   200 handled, duplicate or intentionally ignored
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook not configured" }, { status: 503 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text(); // raw bytes: any re-serialisation would break the signature
  let event: Stripe.Event;
  try {
    event = await Stripe.webhooks.constructEventAsync(
      body,
      signature,
      secret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const outcome = await handleStripeEvent(event);
    return Response.json({ received: true, outcome });
  } catch (err) {
    // Log the event id and error text only: never the payload (it holds customer details).
    console.error(`stripe webhook failed: ${event.id}`, err instanceof Error ? err.message : err);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
