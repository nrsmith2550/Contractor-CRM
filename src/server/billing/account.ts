import type Stripe from "stripe";
import {
  PLANS,
  USERS_INCLUDED,
  isEdition,
  isValidExtraUsers,
  monthlyCentsFor,
  seatsFor,
  setupDifferenceCents,
  type Edition,
} from "@/lib/plans";
import { choiceFromMetadata, metadataFor, type PurchaseChoice } from "./checkout";

/**
 * What a business can do with its own subscription, from its own screens: see it, change the plan
 * or the number of people, update the card, read its invoices, cancel or carry on.
 *
 * Every function takes the licence's own subscription and customer ids and refuses anything that
 * does not belong to them, so the caller never passes an id from the browser. The Stripe client is
 * passed in, so tests can supply a fake.
 */
export type Api = Pick<
  Stripe,
  "subscriptions" | "invoices" | "invoiceItems" | "prices" | "setupIntents" | "customers"
>;

/** The part of a licence these functions need. */
export type Account = {
  edition: Edition;
  extraUsers: number;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  billingStatus: string | null;
};

export type BillingErrorCode =
  "invalid" | "unchanged" | "below_active_users" | "payment_failed" | "not_yours";

/** Something a person can fix, with words they can read. */
export class BillingError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const EXPAND = ["items.data.price.product", "default_payment_method"];

async function load(stripe: Api, account: Account): Promise<Stripe.Subscription> {
  const sub = await stripe.subscriptions.retrieve(account.stripeSubscriptionId, { expand: EXPAND });
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (sub.id !== account.stripeSubscriptionId || customer !== account.stripeCustomerId) {
    throw new BillingError("not_yours", "That subscription does not belong to this business.");
  }
  return sub;
}

type Role = "plan" | "seats";
const roleOf = (item: Stripe.SubscriptionItem): string | undefined =>
  typeof item.price.product === "object" && !("deleted" in item.price.product)
    ? item.price.product.metadata?.role
    : undefined;
const itemFor = (sub: Stripe.Subscription, role: Role) =>
  sub.items.data.find((i) => roleOf(i) === role);

// ---- Reading ----------------------------------------------------------------------------------

export type Card = { brand: string; last4: string; expMonth: number; expYear: number };

export type Overview = {
  status: "active" | "past_due" | "canceled" | "other";
  edition: Edition;
  extraUsers: number;
  seats: number;
  monthlyCents: number;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  card: Card | null;
};

export async function overview(stripe: Api, account: Account): Promise<Overview> {
  const sub = await load(stripe, account);
  const choice = choiceFromMetadata(sub.metadata) ?? {
    edition: account.edition,
    extraUsers: account.extraUsers,
  };
  const pm = sub.default_payment_method;
  const card = pm && typeof pm === "object" && "card" in pm && pm.card ? pm.card : null;
  const end = sub.items.data[0]?.current_period_end;
  const status =
    sub.status === "active" || sub.status === "trialing"
      ? "active"
      : sub.status === "past_due" || sub.status === "unpaid"
        ? "past_due"
        : sub.status === "canceled"
          ? "canceled"
          : "other";
  return {
    status,
    edition: choice.edition,
    extraUsers: choice.extraUsers,
    seats: seatsFor(choice.extraUsers),
    monthlyCents: monthlyCentsFor(choice.edition, choice.extraUsers),
    periodEnd: typeof end === "number" ? new Date(end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    card: card
      ? { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year }
      : null,
  };
}

export type InvoiceRow = {
  id: string;
  number: string | null;
  date: Date;
  totalCents: number;
  status: string;
  pdfUrl: string | null;
};

export async function listInvoices(stripe: Api, account: Account): Promise<InvoiceRow[]> {
  const res = await stripe.invoices.list({ customer: account.stripeCustomerId, limit: 24 });
  return res.data.map((i) => ({
    id: i.id ?? "",
    number: i.number,
    date: new Date(i.created * 1000),
    totalCents: i.total,
    status: i.status ?? "draft",
    pdfUrl: i.invoice_pdf ?? null,
  }));
}

// ---- Changing the plan or the number of people -------------------------------------------------

/**
 * A price for one plan's monthly fee or one person's monthly fee, found by a fixed name so the
 * same one is reused every time. A new one is made only when the amount in `plans.ts` changes.
 */
async function ensurePrice(stripe: Api, edition: Edition, role: Role): Promise<string> {
  const plan = PLANS[edition];
  const amount = role === "plan" ? plan.monthlyCents : plan.extraUserCents;
  const lookupKey = `gantry_${role}_${edition}`;
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const existing = found.data[0];
  if (existing && existing.unit_amount === amount) return existing.id;
  const created = await stripe.prices.create({
    currency: "usd",
    unit_amount: amount,
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    transfer_lookup_key: true,
    product_data: {
      name: role === "plan" ? `${plan.name}, monthly` : "Extra people, monthly",
      metadata: { role, edition },
    },
  });
  return created.id;
}

/** What has to change on the subscription's lines to get from what it is now to `to`. */
async function changeItems(
  stripe: Api,
  sub: Stripe.Subscription,
  from: PurchaseChoice,
  to: PurchaseChoice,
): Promise<Stripe.SubscriptionUpdateParams.Item[]> {
  const items: Stripe.SubscriptionUpdateParams.Item[] = [];
  const planItem = itemFor(sub, "plan");
  const seatItem = itemFor(sub, "seats");
  const planChanged = from.edition !== to.edition;

  if (planItem && planChanged) {
    items.push({ id: planItem.id, price: await ensurePrice(stripe, to.edition, "plan") });
  }
  if (to.extraUsers === 0) {
    if (seatItem) items.push({ id: seatItem.id, deleted: true });
  } else if (seatItem) {
    if (planChanged) {
      items.push({
        id: seatItem.id,
        price: await ensurePrice(stripe, to.edition, "seats"),
        quantity: to.extraUsers,
      });
    } else if (seatItem.quantity !== to.extraUsers) {
      items.push({ id: seatItem.id, quantity: to.extraUsers });
    }
  } else {
    items.push({ price: await ensurePrice(stripe, to.edition, "seats"), quantity: to.extraUsers });
  }
  return items;
}

function check(to: unknown, activeUsers: number): PurchaseChoice {
  const c = to as Partial<PurchaseChoice> | null;
  if (!c || !isEdition(c.edition) || !isValidExtraUsers(c.extraUsers)) {
    throw new BillingError("invalid", "Choose a plan and a number of people from 10 to 50.");
  }
  if (seatsFor(c.extraUsers) < activeUsers) {
    throw new BillingError(
      "below_active_users",
      `You have ${activeUsers} people signed up. Disable some people first, or choose at least ${Math.max(
        USERS_INCLUDED,
        activeUsers,
      )} people.`,
    );
  }
  return { edition: c.edition, extraUsers: c.extraUsers };
}

export type ChangePreview = {
  /** Charged to the card now: the rest of this month's difference plus any setup fee difference. */
  dueNowCents: number;
  /** A credit that comes off the next bill, when the change makes this month cheaper. */
  creditCents: number;
  nextMonthlyCents: number;
  seats: number;
  setupDifferenceCents: number;
};

const isProration = (l: Stripe.InvoiceLineItem) =>
  Boolean(l.parent?.subscription_item_details?.proration);

export async function previewChange(
  stripe: Api,
  account: Account,
  to: unknown,
  activeUsers: number,
): Promise<ChangePreview> {
  const target = check(to, activeUsers);
  const sub = await load(stripe, account);
  const from = choiceFromMetadata(sub.metadata) ?? {
    edition: account.edition,
    extraUsers: account.extraUsers,
  };
  if (from.edition === target.edition && from.extraUsers === target.extraUsers) {
    throw new BillingError("unchanged", "That is what you already have.");
  }
  const items = await changeItems(stripe, sub, from, target);
  const preview = await stripe.invoices.createPreview({
    customer: account.stripeCustomerId,
    subscription: sub.id,
    subscription_details: { items, proration_behavior: "always_invoice" },
  });
  const proration = preview.lines.data.filter(isProration).reduce((n, l) => n + l.amount, 0);
  const setup = setupDifferenceCents(from.edition, target.edition);
  const net = proration + setup;
  return {
    dueNowCents: Math.max(0, net),
    creditCents: Math.max(0, -net),
    nextMonthlyCents: monthlyCentsFor(target.edition, target.extraUsers),
    seats: seatsFor(target.extraUsers),
    setupDifferenceCents: setup,
  };
}

const CARD_PROBLEMS = new Set([
  "card_declined",
  "expired_card",
  "incorrect_cvc",
  "processing_error",
  "insufficient_funds",
  "subscription_payment_intent_requires_action",
  "payment_intent_authentication_failure",
]);

/**
 * Makes the change and charges the difference now. If the card is refused the subscription is left
 * exactly as it was, and nothing is charged.
 */
export async function applyChange(
  stripe: Api,
  account: Account,
  to: unknown,
  activeUsers: number,
): Promise<Stripe.Subscription> {
  const target = check(to, activeUsers);
  const sub = await load(stripe, account);
  const from = choiceFromMetadata(sub.metadata) ?? {
    edition: account.edition,
    extraUsers: account.extraUsers,
  };
  if (from.edition === target.edition && from.extraUsers === target.extraUsers) {
    throw new BillingError("unchanged", "That is what you already have.");
  }
  const items = await changeItems(stripe, sub, from, target);
  const setup = setupDifferenceCents(from.edition, target.edition);
  let pending: string | null = null;
  try {
    if (setup > 0) {
      const item = await stripe.invoiceItems.create({
        customer: account.stripeCustomerId,
        subscription: sub.id,
        currency: "usd",
        amount: setup,
        description: `Setup fee difference: ${PLANS[from.edition].name} to ${PLANS[target.edition].name}`,
      });
      pending = item.id;
    }
    return await stripe.subscriptions.update(sub.id, {
      items,
      metadata: metadataFor(target),
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
    });
  } catch (err) {
    if (pending) await stripe.invoiceItems.del(pending).catch(() => undefined);
    const e = err as { type?: string; code?: string };
    if (e.type === "StripeCardError" || (e.code && CARD_PROBLEMS.has(e.code))) {
      throw new BillingError(
        "payment_failed",
        "Your card was not accepted, so nothing was changed. Update your card and try again.",
      );
    }
    throw err;
  }
}

// ---- Cancelling -------------------------------------------------------------------------------

/** Stops (or carries on) renewing at the end of the paid period. Nothing is refunded or cut short. */
export async function setCancelAtPeriodEnd(
  stripe: Api,
  account: Account,
  cancel: boolean,
): Promise<Stripe.Subscription> {
  const sub = await load(stripe, account);
  return stripe.subscriptions.update(sub.id, { cancel_at_period_end: cancel });
}

// ---- The card ---------------------------------------------------------------------------------

const PURPOSE = "update_card";

/** A one-use form for a new card. Returns the client secret the page needs to draw it. */
export async function startCardUpdate(stripe: Api, account: Account): Promise<string> {
  await load(stripe, account);
  const intent = await stripe.setupIntents.create({
    customer: account.stripeCustomerId,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
    metadata: { purpose: PURPOSE, subscription: account.stripeSubscriptionId },
  });
  if (!intent.client_secret) throw new Error("Stripe did not return a client secret");
  return intent.client_secret;
}

/**
 * Makes the card just entered the one used from now on, for this subscription and the customer.
 * If a payment was overdue, tries the open invoice again with the new card straight away.
 */
export async function finishCardUpdate(
  stripe: Api,
  account: Account,
  setupIntentId: string,
): Promise<{ retriedOverdue: boolean }> {
  const intent = await stripe.setupIntents.retrieve(setupIntentId);
  const customer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  const pm =
    typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
  if (
    customer !== account.stripeCustomerId ||
    intent.metadata?.purpose !== PURPOSE ||
    intent.metadata?.subscription !== account.stripeSubscriptionId ||
    intent.status !== "succeeded" ||
    !pm
  ) {
    throw new BillingError("not_yours", "That card could not be confirmed. Please try again.");
  }
  await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm } });
  const sub = await stripe.subscriptions.update(account.stripeSubscriptionId, {
    default_payment_method: pm,
    expand: ["latest_invoice"],
  });

  let retriedOverdue = false;
  const latest = sub.latest_invoice;
  if (account.billingStatus === "past_due" && latest && typeof latest === "object") {
    if (latest.status === "open" && latest.id) {
      try {
        await stripe.invoices.pay(latest.id, { payment_method: pm });
        retriedOverdue = true;
      } catch {
        // Still declined: the page says so, and Stripe's own retries carry on.
      }
    }
  }
  return { retriedOverdue };
}
