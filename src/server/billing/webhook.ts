import { and, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { z } from "zod";
import { withPlatform, type Tx } from "@/db/client";
import { adminAuditLog, license, stripeEvent } from "@/db/schema";
import { isTier, TIERS } from "@/lib/tiers";
import { sendEmail } from "@/server/email/mailer";
import { licenseKeyEmail } from "@/server/email/templates";
import { mintLicense } from "@/server/licensing/mint";

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

type Deps = { send?: typeof sendEmail; appUrl?: string };

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

async function audit(tx: Tx, action: string, licenseId: string, event: Stripe.Event) {
  // Not an admin action: adminId stays null and the reason names the Stripe event.
  await tx.insert(adminAuditLog).values({
    adminId: null,
    action,
    targetType: "license",
    targetId: licenseId,
    reason: `stripe:${event.type}:${event.id}`,
  });
}

async function onCheckoutPaid(
  tx: Tx,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  deps: Deps,
): Promise<WebhookOutcome> {
  if (session.payment_status !== "paid") return "ignored"; // async methods report later
  const kind = session.metadata?.kind;

  if (kind === "purchase") {
    const tier = session.metadata?.tier;
    const email = session.customer_details?.email;
    const paymentIntent = idOf(session.payment_intent);
    if (!isTier(tier)) throw new Error(`Unknown tier on session ${session.id}`);
    if (!email) throw new Error(`No customer email on session ${session.id}`);
    if (!paymentIntent) throw new Error(`No payment intent on session ${session.id}`);

    const minted = await mintLicense(
      {
        tier,
        buyerEmail: email,
        amountPaidCents: session.amount_total ?? TIERS[tier].priceCents,
        stripeCustomerId: idOf(session.customer) ?? undefined,
        stripePaymentIntentId: paymentIntent,
      },
      tx,
    );
    if (!minted) return "duplicate"; // this payment already has a license
    // The key exists only in memory here. Send it before the transaction commits: if sending
    // fails we throw, the license rolls back, and Stripe retries with a fresh key. A committed
    // license whose key was never delivered cannot happen.
    const appUrl = deps.appUrl ?? process.env.APP_URL ?? "";
    await (deps.send ?? sendEmail)(licenseKeyEmail({ to: email, key: minted.key, tier, appUrl }));
    await audit(tx, "stripe.license_minted", minted.licenseId, event);
    return "processed";
  }

  if (kind === "upgrade") {
    const parsed = z
      .object({ licenseId: z.string().uuid(), toTier: z.string().refine(isTier) })
      .safeParse(session.metadata);
    if (!parsed.success) throw new Error(`Bad upgrade metadata on session ${session.id}`);
    const toTier = parsed.data.toTier as keyof typeof TIERS;

    const [lic] = await tx
      .select()
      .from(license)
      .where(eq(license.id, parsed.data.licenseId))
      .for("update");
    if (!lic) throw new Error(`Upgrade for unknown license ${parsed.data.licenseId}`);
    if (lic.status === "revoked") return "ignored";
    if (TIERS[toTier].seatLimit <= lic.seatLimit) return "ignored"; // already at or above

    await tx
      .update(license)
      .set({
        tier: toTier,
        seatLimit: TIERS[toTier].seatLimit,
        amountPaidCents: lic.amountPaidCents + (session.amount_total ?? 0),
        stripeCustomerId: lic.stripeCustomerId ?? idOf(session.customer),
      })
      .where(eq(license.id, lic.id));
    await audit(tx, "stripe.license_upgraded", lic.id, event);
    return "processed";
  }

  return "ignored";
}

/** Sets a license's status from a payment problem, found via its original payment intent. */
async function setStatusByPaymentIntent(
  tx: Tx,
  event: Stripe.Event,
  paymentIntent: string | null,
  status: "suspended" | "revoked",
  from: ("issued" | "active" | "suspended")[],
  action: string,
): Promise<WebhookOutcome> {
  if (!paymentIntent) return "ignored";
  const rows = await tx
    .update(license)
    .set({ status })
    .where(and(eq(license.stripePaymentIntentId, paymentIntent), inArray(license.status, from)))
    .returning({ id: license.id });
  for (const r of rows) await audit(tx, action, r.id, event);
  return rows.length ? "processed" : "ignored";
}

/**
 * Applies one verified Stripe event. Runs in a single transaction that also records the event
 * id, so a duplicate delivery is a no-op and a failure rolls everything back (Stripe retries).
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  deps: Deps = {},
): Promise<WebhookOutcome> {
  return withPlatform(async (tx) => {
    const fresh = await tx
      .insert(stripeEvent)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing()
      .returning({ id: stripeEvent.id });
    if (fresh.length === 0) return "duplicate";

    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return onCheckoutPaid(tx, event, event.data.object, deps);

      case "charge.refunded": {
        const charge = event.data.object;
        if (charge.amount_refunded < charge.amount) return "ignored"; // partial refund
        return setStatusByPaymentIntent(
          tx,
          event,
          idOf(charge.payment_intent),
          "revoked",
          ["issued", "active", "suspended"],
          "stripe.refund_revoke",
        );
      }

      case "charge.dispute.created":
        return setStatusByPaymentIntent(
          tx,
          event,
          idOf(event.data.object.payment_intent),
          "suspended",
          ["issued", "active"],
          "stripe.dispute_suspend",
        );

      case "charge.dispute.closed": {
        const dispute = event.data.object;
        const pi = idOf(dispute.payment_intent);
        if (dispute.status === "lost") {
          return setStatusByPaymentIntent(
            tx,
            event,
            pi,
            "revoked",
            ["issued", "active", "suspended"],
            "stripe.dispute_lost_revoke",
          );
        }
        if (dispute.status === "won" && pi) {
          // Restore: back to active if it was ever bound to a tenant, otherwise issued.
          const [lic] = await tx
            .select()
            .from(license)
            .where(and(eq(license.stripePaymentIntentId, pi), eq(license.status, "suspended")));
          if (!lic) return "ignored";
          await tx
            .update(license)
            .set({ status: lic.tenantId ? "active" : "issued" })
            .where(eq(license.id, lic.id));
          await audit(tx, "stripe.dispute_won_restore", lic.id, event);
          return "processed";
        }
        return "ignored";
      }

      default:
        return "ignored";
    }
  });
}
