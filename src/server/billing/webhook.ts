import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { withPlatform, type Tx } from "@/db/client";
import { adminAuditLog, license, stripeEvent } from "@/db/schema";
import { seatsFor } from "@/lib/plans";
import { sendEmail } from "@/server/email/mailer";
import { licenseKeyEmail } from "@/server/email/templates";
import { mintLicense } from "@/server/licensing/mint";
import { choiceFromMetadata } from "./checkout";
import { getStripe } from "./stripe";

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

/** The few Stripe calls the webhook makes, so tests can supply fakes. Real ones are used otherwise. */
type Deps = {
  send?: typeof sendEmail;
  appUrl?: string;
  subscriptions?: { retrieve(id: string): Promise<Stripe.Subscription> };
  charges?: { retrieve(id: string): Promise<Stripe.Charge> };
};

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  typeof v === "string" ? v : (v?.id ?? null);

const subscriptionsOf = (deps: Deps) => deps.subscriptions ?? getStripe().subscriptions;
const chargesOf = (deps: Deps) => deps.charges ?? getStripe().charges;

/** Where a change came from: a Stripe event, or the Billing page. Named in the audit trail. */
type Source = { type: string; id: string };

async function audit(tx: Tx, action: string, licenseId: string, event: Source) {
  // Not an admin action: adminId stays null and the reason names the Stripe event.
  await tx.insert(adminAuditLog).values({
    adminId: null,
    action,
    targetType: "license",
    targetId: licenseId,
    reason: `stripe:${event.type}:${event.id}`,
  });
}

/** Our word for how a Stripe subscription is doing, or null while it is not yet decided. */
function billingStatusOf(
  status: Stripe.Subscription.Status,
): "active" | "past_due" | "canceled" | null {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // "incomplete": the first payment has not gone through yet
  }
}

const periodEndOf = (sub: Stripe.Subscription): Date | null => {
  const t = sub.items.data[0]?.current_period_end;
  return typeof t === "number" ? new Date(t * 1000) : null;
};

/**
 * Brings a licence in line with its subscription. Always called with a freshly read subscription,
 * so the order events arrive in never matters. A subscription with no licence of ours is ignored.
 *
 * - The plan and number of people come from the subscription, so the licence follows what is paid for.
 * - A cancelled subscription suspends the licence (the business is signed out on its next request);
 *   a failed payment only flags it, because Stripe keeps retrying and the owner can still fix it.
 * - A subscription that comes back to active restores a licence that billing had suspended, and
 *   never one an administrator suspended or revoked.
 */
async function reconcile(tx: Tx, event: Source, sub: Stripe.Subscription): Promise<WebhookOutcome> {
  const [lic] = await tx
    .select()
    .from(license)
    .where(eq(license.stripeSubscriptionId, sub.id))
    .for("update");
  if (!lic) return "ignored";

  const billing = billingStatusOf(sub.status);
  if (!billing) return "ignored";
  const choice = choiceFromMetadata(sub.metadata);
  const patch: Partial<typeof license.$inferInsert> = {
    billingStatus: billing,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
  const end = periodEndOf(sub);
  if (end) patch.currentPeriodEnd = end;
  if (choice) {
    patch.edition = choice.edition;
    patch.extraUsers = choice.extraUsers;
    patch.seatLimit = seatsFor(choice.extraUsers);
  }
  const wasBillingProblem = lic.billingStatus === "past_due" || lic.billingStatus === "canceled";
  if (billing === "canceled" && (lic.status === "issued" || lic.status === "active")) {
    patch.status = "suspended";
  } else if (billing === "active" && wasBillingProblem && lic.status === "suspended") {
    patch.status = lic.tenantId ? "active" : "issued";
  }
  await tx.update(license).set(patch).where(eq(license.id, lic.id));

  if (patch.status) await audit(tx, `stripe.license_${patch.status}`, lic.id, event);
  if (choice && (choice.edition !== lic.edition || patch.seatLimit !== lic.seatLimit)) {
    await audit(tx, "stripe.license_changed", lic.id, event);
  }
  return "processed";
}

/**
 * Brings the licence in line with a subscription right now, for changes made on the Billing page,
 * so the screen is correct without waiting for the event. The event that follows finds nothing
 * left to do. Safe to run any number of times.
 */
export async function syncLicenseFromSubscription(sub: Stripe.Subscription): Promise<void> {
  await withPlatform((tx) => reconcile(tx, { type: "billing_page", id: `sync_${sub.id}` }, sub));
}

async function onCheckoutPaid(
  tx: Tx,
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  deps: Deps,
): Promise<WebhookOutcome> {
  if (session.mode !== "subscription") return "ignored";
  if (session.payment_status !== "paid") return "ignored"; // async methods report later
  if (session.metadata?.kind !== "subscription") return "ignored";

  const choice = choiceFromMetadata(session.metadata);
  const email = session.customer_details?.email;
  const subscriptionId = idOf(session.subscription);
  if (!choice) throw new Error(`Bad purchase metadata on session ${session.id}`);
  if (!email) throw new Error(`No customer email on session ${session.id}`);
  if (!subscriptionId) throw new Error(`No subscription on session ${session.id}`);

  const minted = await mintLicense(
    {
      edition: choice.edition,
      extraUsers: choice.extraUsers,
      seatLimit: seatsFor(choice.extraUsers),
      buyerEmail: email,
      amountPaidCents: session.amount_total ?? 0,
      stripeCustomerId: idOf(session.customer) ?? undefined,
      stripeSubscriptionId: subscriptionId,
      billingStatus: "active",
    },
    tx,
  );
  if (!minted) return "duplicate"; // this subscription already has a licence

  // The key exists only in memory here. Send it before the transaction commits: if sending fails
  // we throw, the licence rolls back, and Stripe retries with a fresh key. A committed licence whose
  // key was never delivered cannot happen.
  const appUrl = deps.appUrl ?? process.env.APP_URL ?? "";
  await (deps.send ?? sendEmail)(
    licenseKeyEmail({
      to: email,
      key: minted.key,
      edition: choice.edition,
      extraUsers: choice.extraUsers,
      appUrl,
    }),
  );
  await audit(tx, "stripe.license_minted", minted.licenseId, event);
  // Fill in the renewal date and anything else only the subscription itself knows.
  await reconcile(tx, event, await subscriptionsOf(deps).retrieve(subscriptionId));
  return "processed";
}

/** Suspends, revokes or restores the licences paid for by a Stripe customer (disputes). */
async function setStatusByCustomer(
  tx: Tx,
  event: Stripe.Event,
  customer: string | null,
  to: "suspended" | "revoked" | "restore",
  action: string,
): Promise<WebhookOutcome> {
  if (!customer) return "ignored";
  const rows = await tx.select().from(license).where(eq(license.stripeCustomerId, customer));
  let changed = 0;
  for (const lic of rows) {
    let next: "suspended" | "revoked" | "active" | "issued" | null = null;
    if (to === "suspended" && (lic.status === "issued" || lic.status === "active")) {
      next = "suspended";
    }
    if (to === "revoked" && lic.status !== "revoked") next = "revoked";
    if (to === "restore" && lic.status === "suspended") next = lic.tenantId ? "active" : "issued";
    if (!next) continue;
    await tx.update(license).set({ status: next }).where(eq(license.id, lic.id));
    await audit(tx, action, lic.id, event);
    changed++;
  }
  return changed ? "processed" : "ignored";
}

const customerOfDispute = async (dispute: Stripe.Dispute, deps: Deps): Promise<string | null> => {
  const charge = idOf(dispute.charge);
  return charge ? idOf((await chargesOf(deps).retrieve(charge)).customer) : null;
};

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

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        return reconcile(tx, event, await subscriptionsOf(deps).retrieve(event.data.object.id));

      case "invoice.paid":
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subId = idOf(invoice.parent?.subscription_details?.subscription);
        if (!subId) return "ignored"; // not a subscription invoice
        const outcome = await reconcile(tx, event, await subscriptionsOf(deps).retrieve(subId));
        if (event.type === "invoice.paid" && invoice.billing_reason !== "subscription_create") {
          // Renewals and changes add to what the business has paid in total. The first invoice is
          // already counted from the checkout, so it is not added twice.
          const [lic] = await tx
            .select()
            .from(license)
            .where(eq(license.stripeSubscriptionId, subId));
          if (lic) {
            await tx
              .update(license)
              .set({ amountPaidCents: lic.amountPaidCents + invoice.amount_paid })
              .where(eq(license.id, lic.id));
          }
        }
        return outcome;
      }

      case "charge.dispute.created":
        return setStatusByCustomer(
          tx,
          event,
          await customerOfDispute(event.data.object, deps),
          "suspended",
          "stripe.dispute_suspend",
        );

      case "charge.dispute.closed": {
        const dispute = event.data.object;
        if (dispute.status === "lost") {
          return setStatusByCustomer(
            tx,
            event,
            await customerOfDispute(dispute, deps),
            "revoked",
            "stripe.dispute_lost_revoke",
          );
        }
        if (dispute.status === "won") {
          return setStatusByCustomer(
            tx,
            event,
            await customerOfDispute(dispute, deps),
            "restore",
            "stripe.dispute_won_restore",
          );
        }
        return "ignored";
      }

      default:
        return "ignored";
    }
  });
}
