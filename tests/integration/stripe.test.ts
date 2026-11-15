import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import { withPlatform } from "@/db/client";
import { adminAuditLog, license, stripeEvent } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { createSession, validateSession } from "@/server/auth/session";
import { handleStripeEvent } from "@/server/billing/webhook";
import { getOutbox, type Email } from "@/server/email/mailer";

// The route calls the real Stripe client to read a subscription back. Tests give it this one,
// which answers from `subs`, so nothing here ever reaches Stripe.
const subs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/server/billing/stripe", () => ({
  getStripe: () => ({
    subscriptions: { retrieve: async (id: string) => subs.get(id) },
    charges: { retrieve: async () => ({ customer: null }) },
  }),
}));

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const APP_URL = "https://app.example.test";
const PASSWORD = "violet-lantern-orbit-42";
const PERIOD_END = 1_900_000_000; // seconds, far in the future

type Obj = Record<string, unknown>;
const evt = (type: string, object: Obj, id = `evt_${rand()}`) =>
  ({ id, type, data: { object } }) as unknown as Stripe.Event;

/** A subscription as Stripe would hand it back, with the metadata our checkout puts on it. */
function sub(id: string, over: Obj = {}, meta: Obj = {}) {
  const s = {
    id,
    status: "active",
    cancel_at_period_end: false,
    customer: `cus_${rand()}`,
    metadata: { kind: "subscription", edition: "complete", extraUsers: "0", ...meta },
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...over,
  };
  subs.set(id, s);
  return s;
}

const fakeStripe = () => ({
  subscriptions: { retrieve: async (id: string) => subs.get(id) as Stripe.Subscription },
});

function purchase(meta: Obj = {}, over: Obj = {}) {
  const email = `buyer-${rand()}@example.test`;
  const subId = `sub_${rand()}`;
  const customer = `cus_${rand()}`;
  const s = sub(subId, { customer }, meta);
  const object: Obj = {
    id: `cs_${rand()}`,
    mode: "subscription",
    payment_status: "paid",
    amount_total: 57_000,
    customer,
    subscription: subId,
    customer_details: { email },
    metadata: s.metadata,
    ...over,
  };
  return { email, subId, customer, object, event: evt("checkout.session.completed", object) };
}

const bySub = async (id: string) =>
  (
    await withPlatform((tx) =>
      tx.select().from(license).where(eq(license.stripeSubscriptionId, id)),
    )
  )[0];

const keyFrom = (e: Email) =>
  /CRM-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}/.exec(e.text)![0];

async function activate(key: string, label: string) {
  const id = rand();
  return activateLicense({
    licenseKey: key,
    companyName: `${label} ${id}`,
    ownerName: "Pat Buyer",
    ownerEmail: `owner-${id}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "America/New_York",
    currency: "USD",
    ip: `ip-${id}`,
  });
}

/** Buys a plan and returns what later lifecycle tests need. */
async function bought(meta: Obj = {}) {
  const p = purchase(meta);
  const send = vi.fn(async (_e: Email) => {});
  await handleStripeEvent(p.event, { send, appUrl: APP_URL, ...fakeStripe() });
  return { ...p, send };
}

const invoice = (subId: string, over: Obj = {}) => ({
  id: `in_${rand()}`,
  amount_paid: 7_000,
  billing_reason: "subscription_cycle",
  parent: { subscription_details: { subscription: subId } },
  ...over,
});

describe.skipIf(!enabled)("Stripe webhook (real Postgres, fabricated events)", () => {
  afterEach(() => vi.unstubAllEnvs());

  describe("buying", () => {
    it("a paid subscription mints an issued licence for the plan and people bought, and emails a key that activates", async () => {
      const p = purchase({ edition: "deals", extraUsers: "5" });
      const send = vi.fn(async (_e: Email) => {});
      expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL, ...fakeStripe() })).toBe(
        "processed",
      );

      const lic = await bySub(p.subId);
      expect(lic).toMatchObject({
        status: "issued",
        edition: "deals",
        extraUsers: 5,
        seatLimit: 15,
        amountPaidCents: 57_000,
        buyerEmail: p.email,
        tenantId: null,
        billingStatus: "active",
        cancelAtPeriodEnd: false,
        stripeCustomerId: p.customer,
      });
      expect(lic!.currentPeriodEnd?.getTime()).toBe(PERIOD_END * 1000);

      expect(send).toHaveBeenCalledTimes(1);
      const mail = send.mock.calls[0]![0];
      expect(mail.to).toBe(p.email);
      expect(mail.subject).toContain("Gantry Deals");
      expect(mail.text).toContain("up to 15 users");
      expect(mail.text).toContain(`${APP_URL}/activate`);

      const key = keyFrom(mail);
      expect(lic!.keyLast5).toBe(key.replace(/-/g, "").slice(-5));
      expect((await activate(key, "Buyer Co")).ok).toBe(true);
      expect((await bySub(p.subId))!.status).toBe("active");

      const audit = await withPlatform((tx) =>
        tx.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, lic!.id)),
      );
      expect(audit.map((a) => a.action)).toContain("stripe.license_minted");
      expect(audit[0]!.adminId).toBeNull();
    });

    it("a redelivered event, or a second event for the same subscription, mints nothing new", async () => {
      const p = purchase();
      const send = vi.fn(async (_e: Email) => {});
      const deps = { send, appUrl: APP_URL, ...fakeStripe() };
      expect(await handleStripeEvent(p.event, deps)).toBe("processed");
      expect(await handleStripeEvent(p.event, deps)).toBe("duplicate");
      const again = evt("checkout.session.async_payment_succeeded", p.object);
      expect(await handleStripeEvent(again, deps)).toBe("duplicate");
      expect(send).toHaveBeenCalledTimes(1);
      const rows = await withPlatform((tx) =>
        tx.select().from(license).where(eq(license.stripeSubscriptionId, p.subId)),
      );
      expect(rows).toHaveLength(1);
    });

    it("if the email fails nothing is committed, so Stripe's retry delivers a key", async () => {
      const p = purchase();
      const failing = vi.fn(async (_e: Email) => {
        throw new Error("provider down");
      });
      await expect(
        handleStripeEvent(p.event, { send: failing, appUrl: APP_URL, ...fakeStripe() }),
      ).rejects.toThrow(/provider down/);
      expect(await bySub(p.subId)).toBeUndefined();
      const recorded = await withPlatform((tx) =>
        tx.select().from(stripeEvent).where(eq(stripeEvent.id, p.event.id)),
      );
      expect(recorded).toEqual([]);

      const send = vi.fn(async (_e: Email) => {});
      expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL, ...fakeStripe() })).toBe(
        "processed",
      );
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("if Stripe cannot be read, no key is emailed and nothing is saved, so the retry starts clean", async () => {
      const p = purchase();
      const send = vi.fn(async (_e: Email) => {});
      const broken = {
        subscriptions: {
          retrieve: async () => {
            throw new Error("Permission denied: Subscriptions Read");
          },
        },
      };
      await expect(
        handleStripeEvent(p.event, { send, appUrl: APP_URL, ...broken }),
      ).rejects.toThrow(/Permission denied/);
      expect(send).not.toHaveBeenCalled(); // no key in anyone's inbox
      expect(await bySub(p.subId)).toBeUndefined(); // no licence saved
      const recorded = await withPlatform((tx) =>
        tx.select().from(stripeEvent).where(eq(stripeEvent.id, p.event.id)),
      );
      expect(recorded).toEqual([]); // the event can be retried

      // Once Stripe can be read again, the same event goes through and sends exactly one key.
      expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL, ...fakeStripe() })).toBe(
        "processed",
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(await bySub(p.subId)).toMatchObject({ status: "issued", billingStatus: "active" });
    });

    it("ignores unpaid sessions, one-off payments, other kinds and unrelated events", async () => {
      const send = vi.fn(async (_e: Email) => {});
      const deps = { send, ...fakeStripe() };
      const unpaid = purchase({}, { payment_status: "unpaid" });
      expect(await handleStripeEvent(unpaid.event, deps)).toBe("ignored");
      expect(await bySub(unpaid.subId)).toBeUndefined();

      expect(await handleStripeEvent(purchase({}, { mode: "payment" }).event, deps)).toBe(
        "ignored",
      );
      expect(
        await handleStripeEvent(purchase({}, { metadata: { kind: "something-else" } }).event, deps),
      ).toBe("ignored");
      expect(await handleStripeEvent(evt("customer.created", {}), deps)).toBe("ignored");
      expect(send).not.toHaveBeenCalled();
    });

    it("throws for a purchase it cannot make sense of, so Stripe retries and we are alerted", async () => {
      const send = vi.fn(async (_e: Email) => {});
      const deps = { send, ...fakeStripe() };
      await expect(
        handleStripeEvent(purchase({ edition: "platinum" }).event, deps),
      ).rejects.toThrow(/Bad purchase metadata/);
      await expect(handleStripeEvent(purchase({ extraUsers: "999" }).event, deps)).rejects.toThrow(
        /Bad purchase metadata/,
      );
      await expect(
        handleStripeEvent(purchase({}, { customer_details: {} }).event, deps),
      ).rejects.toThrow(/customer email/);
      await expect(
        handleStripeEvent(purchase({}, { subscription: null }).event, deps),
      ).rejects.toThrow(/No subscription/);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("keeping the licence in line with the subscription", () => {
    const deps = (send = vi.fn(async (_e: Email) => {})) => ({
      send,
      appUrl: APP_URL,
      ...fakeStripe(),
    });

    it("a failed payment flags the account but keeps it working; paying restores it and adds to the total", async () => {
      const b = await bought();
      sub(b.subId, { customer: b.customer, status: "past_due" });
      expect(await handleStripeEvent(evt("invoice.payment_failed", invoice(b.subId)), deps())).toBe(
        "processed",
      );
      expect(await bySub(b.subId)).toMatchObject({ billingStatus: "past_due", status: "issued" });

      sub(b.subId, { customer: b.customer, status: "active" });
      await handleStripeEvent(evt("invoice.paid", invoice(b.subId)), deps());
      expect(await bySub(b.subId)).toMatchObject({
        billingStatus: "active",
        amountPaidCents: 57_000 + 7_000,
      });
    });

    it("the first invoice is not counted twice", async () => {
      const b = await bought();
      await handleStripeEvent(
        evt("invoice.paid", invoice(b.subId, { billing_reason: "subscription_create" })),
        deps(),
      );
      expect((await bySub(b.subId))!.amountPaidCents).toBe(57_000);
    });

    it("an invoice that is not for a subscription is ignored", async () => {
      expect(
        await handleStripeEvent(evt("invoice.paid", { id: "in_x", amount_paid: 100 }), deps()),
      ).toBe("ignored");
    });

    it("adding people or changing plan updates the licence from the subscription", async () => {
      const b = await bought();
      sub(b.subId, { customer: b.customer }, { edition: "complete", extraUsers: "12" });
      expect(
        await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps()),
      ).toBe("processed");
      expect(await bySub(b.subId)).toMatchObject({
        edition: "complete",
        extraUsers: 12,
        seatLimit: 22,
      });

      sub(b.subId, { customer: b.customer }, { edition: "jobs", extraUsers: "0" });
      await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps());
      const lic = (await bySub(b.subId))!;
      expect(lic).toMatchObject({ edition: "jobs", extraUsers: 0, seatLimit: 10 });

      const audit = await withPlatform((tx) =>
        tx.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, lic.id)),
      );
      expect(audit.filter((a) => a.action === "stripe.license_changed")).toHaveLength(2);
    });

    it("remembers when a cancellation is scheduled and keeps working until then", async () => {
      const b = await bought();
      sub(b.subId, { customer: b.customer, cancel_at_period_end: true });
      await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps());
      expect(await bySub(b.subId)).toMatchObject({ cancelAtPeriodEnd: true, status: "issued" });

      sub(b.subId, { customer: b.customer, cancel_at_period_end: false });
      await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps());
      expect((await bySub(b.subId))!.cancelAtPeriodEnd).toBe(false);
    });

    it("a cancelled subscription suspends the licence and signs the business out; coming back restores it", async () => {
      const b = await bought();
      const act = await activate(keyFrom(b.send.mock.calls[0]![0]), "Cancel Co");
      if (!act.ok) throw new Error("activation failed");
      const { token } = await createSession({ tenantId: act.tenantId, userId: act.userId });
      expect((await validateSession(token)).ok).toBe(true);

      sub(b.subId, { customer: b.customer, status: "canceled" });
      expect(
        await handleStripeEvent(evt("customer.subscription.deleted", { id: b.subId }), deps()),
      ).toBe("processed");
      expect(await bySub(b.subId)).toMatchObject({
        status: "suspended",
        billingStatus: "canceled",
      });
      expect(await validateSession(token)).toEqual({ ok: false, reason: "license_inactive" });

      sub(b.subId, { customer: b.customer, status: "active" });
      await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps());
      expect(await bySub(b.subId)).toMatchObject({ status: "active", billingStatus: "active" });
      expect((await validateSession(token)).ok).toBe(true);
    });

    it("never restores a licence an administrator suspended or revoked", async () => {
      const b = await bought();
      await withPlatform((tx) =>
        tx
          .update(license)
          .set({ status: "suspended" })
          .where(eq(license.stripeSubscriptionId, b.subId)),
      );
      await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps());
      expect((await bySub(b.subId))!.status).toBe("suspended");

      await withPlatform((tx) =>
        tx
          .update(license)
          .set({ status: "revoked", billingStatus: "canceled" })
          .where(eq(license.stripeSubscriptionId, b.subId)),
      );
      await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps());
      expect((await bySub(b.subId))!.status).toBe("revoked");
    });

    it("events for a subscription we have no licence for, or one still being set up, change nothing", async () => {
      sub("sub_unknown");
      expect(
        await handleStripeEvent(
          evt("customer.subscription.updated", { id: "sub_unknown" }),
          deps(),
        ),
      ).toBe("ignored");

      const b = await bought();
      sub(b.subId, { customer: b.customer, status: "incomplete" });
      expect(
        await handleStripeEvent(evt("customer.subscription.updated", { id: b.subId }), deps()),
      ).toBe("ignored");
      expect((await bySub(b.subId))!.status).toBe("issued");
    });
  });

  describe("chargebacks", () => {
    it("a dispute suspends, winning restores, losing revokes; refunds alone change nothing", async () => {
      const b = await bought();
      const deps = {
        charges: { retrieve: async () => ({ customer: b.customer }) as unknown as Stripe.Charge },
        ...fakeStripe(),
      };
      const dispute = (status?: string) => ({ charge: "ch_1", ...(status ? { status } : {}) });

      expect(await handleStripeEvent(evt("charge.dispute.created", dispute()), deps)).toBe(
        "processed",
      );
      expect((await bySub(b.subId))!.status).toBe("suspended");

      // Won while never activated: back to issued.
      expect(await handleStripeEvent(evt("charge.dispute.closed", dispute("won")), deps)).toBe(
        "processed",
      );
      expect((await bySub(b.subId))!.status).toBe("issued");

      await handleStripeEvent(evt("charge.dispute.created", dispute()), deps);
      expect(await handleStripeEvent(evt("charge.dispute.closed", dispute("lost")), deps)).toBe(
        "processed",
      );
      expect((await bySub(b.subId))!.status).toBe("revoked");

      expect(
        await handleStripeEvent(
          evt("charge.refunded", { amount: 100, amount_refunded: 100 }),
          deps,
        ),
      ).toBe("ignored");
      expect((await bySub(b.subId))!.status).toBe("revoked");
    });

    it("a dispute on a charge with no known customer changes nothing", async () => {
      const deps = {
        charges: { retrieve: async () => ({ customer: "cus_nobody" }) as unknown as Stripe.Charge },
        ...fakeStripe(),
      };
      expect(await handleStripeEvent(evt("charge.dispute.created", { charge: "ch_2" }), deps)).toBe(
        "ignored",
      );
    });
  });

  describe("POST /api/stripe/webhook", () => {
    const SECRET = "whsec_test_secret_for_integration";
    const post = (body: string, headers: Record<string, string> = {}) =>
      POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers }));
    const signed = (body: string, secret = SECRET) =>
      Stripe.webhooks.generateTestHeaderString({ payload: body, secret });

    it("is not available until a webhook secret is configured", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
      expect((await post("{}", { "stripe-signature": "x" })).status).toBe(503);
    });

    it("rejects missing, wrong and tampered signatures with 400 and does nothing", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
      const p = purchase();
      const body = JSON.stringify({ ...p.event, object: "event" });

      expect((await post(body)).status).toBe(400);
      expect((await post(body, { "stripe-signature": "t=1,v1=deadbeef" })).status).toBe(400);
      expect((await post(body, { "stripe-signature": signed(body, "whsec_other") })).status).toBe(
        400,
      );
      expect((await post(body + " ", { "stripe-signature": signed(body) })).status).toBe(400);
      expect(await bySub(p.subId)).toBeUndefined();
    });

    it("a correctly signed purchase mints a licence and queues the email", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
      vi.stubEnv("RESEND_API_KEY", "");
      vi.stubEnv("APP_URL", APP_URL);
      const p = purchase({ edition: "jobs", extraUsers: "2" });
      const body = JSON.stringify({ ...p.event, object: "event" });

      const res = await post(body, { "stripe-signature": signed(body) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, outcome: "processed" });
      expect(await bySub(p.subId)).toMatchObject({
        status: "issued",
        edition: "jobs",
        seatLimit: 12,
      });
      expect(getOutbox().some((m) => m.to === p.email)).toBe(true);

      // Stripe redelivers: still 200, still one licence.
      const again = await post(body, { "stripe-signature": signed(body) });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ received: true, outcome: "duplicate" });
    });

    it("returns 500 (so Stripe retries) when a valid event cannot be applied", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
      const p = purchase({ edition: "platinum" });
      const body = JSON.stringify({ ...p.event, object: "event" });
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await post(body, { "stripe-signature": signed(body) });
      expect(res.status).toBe(500);
      // The log line has the event id and message, never the payload (customer email).
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).toContain(p.event.id);
      expect(logged).not.toContain(p.email);
      spy.mockRestore();
    });
  });
});
