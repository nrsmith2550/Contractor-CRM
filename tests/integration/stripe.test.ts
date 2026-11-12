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
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const APP_URL = "https://app.example.test";
const PASSWORD = "violet-lantern-orbit-42";

type Obj = Record<string, unknown>;
const evt = (type: string, object: Obj, id = `evt_${rand()}`) =>
  ({ id, type, data: { object } }) as unknown as Stripe.Event;

function purchase(over: Obj = {}, tier = "team") {
  const email = `buyer-${rand()}@example.test`;
  const pi = `pi_${rand()}`;
  const object: Obj = {
    id: `cs_${rand()}`,
    payment_status: "paid",
    amount_total: 129_900,
    customer: `cus_${rand()}`,
    customer_details: { email },
    payment_intent: pi,
    metadata: { kind: "purchase", tier },
    ...over,
  };
  return { email, pi, object, event: evt("checkout.session.completed", object) };
}

const licenseByPi = async (pi: string) =>
  (
    await withPlatform((tx) =>
      tx.select().from(license).where(eq(license.stripePaymentIntentId, pi)),
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

describe.skipIf(!enabled)("Stripe webhook (real Postgres, fabricated events)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a paid purchase mints an issued license and emails a key that really activates", async () => {
    const p = purchase();
    const send = vi.fn(async (_e: Email) => {});
    expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL })).toBe("processed");

    const lic = await licenseByPi(p.pi);
    expect(lic).toMatchObject({
      status: "issued",
      tier: "team",
      seatLimit: 15,
      amountPaidCents: 129_900,
      buyerEmail: p.email,
      tenantId: null,
    });
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0]![0];
    expect(mail.to).toBe(p.email);
    expect(mail.text).toContain(`${APP_URL}/activate`);

    // The emailed key is the one whose hash is stored, and it activates exactly that license.
    const key = keyFrom(mail);
    expect(lic!.keyLast5).toBe(key.replace(/-/g, "").slice(-5));
    expect((await activate(key, "Buyer Co")).ok).toBe(true);
    expect((await licenseByPi(p.pi))!.status).toBe("active");

    const audit = await withPlatform((tx) =>
      tx.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, lic!.id)),
    );
    expect(audit.map((a) => a.action)).toContain("stripe.license_minted");
    expect(audit[0]!.adminId).toBeNull();
  });

  it("a redelivered event is a no-op: no second license, no second email", async () => {
    const p = purchase();
    const send = vi.fn(async (_e: Email) => {});
    expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL })).toBe("processed");
    expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL })).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
    const rows = await withPlatform((tx) =>
      tx.select().from(license).where(eq(license.stripePaymentIntentId, p.pi)),
    );
    expect(rows).toHaveLength(1);
  });

  it("a different event for the same payment (async success after completed) mints nothing new", async () => {
    const p = purchase();
    const send = vi.fn(async (_e: Email) => {});
    await handleStripeEvent(p.event, { send, appUrl: APP_URL });
    const again = evt("checkout.session.async_payment_succeeded", p.object);
    expect(await handleStripeEvent(again, { send, appUrl: APP_URL })).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("if the email fails nothing is committed, so Stripe's retry delivers a key", async () => {
    const p = purchase();
    const failing = vi.fn(async (_e: Email) => {
      throw new Error("provider down");
    });
    await expect(handleStripeEvent(p.event, { send: failing, appUrl: APP_URL })).rejects.toThrow(
      /provider down/,
    );
    expect(await licenseByPi(p.pi)).toBeUndefined(); // no orphaned license without a delivered key
    const recorded = await withPlatform((tx) =>
      tx.select().from(stripeEvent).where(eq(stripeEvent.id, p.event.id)),
    );
    expect(recorded).toEqual([]);

    const send = vi.fn(async (_e: Email) => {});
    expect(await handleStripeEvent(p.event, { send, appUrl: APP_URL })).toBe("processed");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("ignores unpaid sessions, unknown kinds and unrelated events", async () => {
    const send = vi.fn(async (_e: Email) => {});
    const unpaid = purchase({ payment_status: "unpaid" });
    expect(await handleStripeEvent(unpaid.event, { send })).toBe("ignored");
    expect(await licenseByPi(unpaid.pi)).toBeUndefined();

    const other = purchase({ metadata: { kind: "something-else" } });
    expect(await handleStripeEvent(other.event, { send })).toBe("ignored");

    expect(await handleStripeEvent(evt("customer.created", {}), { send })).toBe("ignored");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a purchase with an unknown tier or no email so Stripe retries", async () => {
    const send = vi.fn(async (_e: Email) => {});
    await expect(handleStripeEvent(purchase({}, "platinum").event, { send })).rejects.toThrow(
      /Unknown tier/,
    );
    await expect(
      handleStripeEvent(purchase({ customer_details: {} }).event, { send }),
    ).rejects.toThrow(/customer email/);
    expect(send).not.toHaveBeenCalled();
  });

  describe("upgrades", () => {
    const upgrade = (licenseId: string, toTier: string, amount = 170_000) =>
      evt("checkout.session.completed", {
        id: `cs_${rand()}`,
        payment_status: "paid",
        amount_total: amount,
        customer: "cus_upgrade",
        metadata: { kind: "upgrade", licenseId, toTier },
      });

    it("raises the seat limit on the same license, no new key", async () => {
      const { licenseId } = await mintLicense({ tier: "team", amountPaidCents: 129_900 });
      const send = vi.fn(async (_e: Email) => {});
      expect(await handleStripeEvent(upgrade(licenseId, "business"), { send })).toBe("processed");
      const [lic] = await withPlatform((tx) =>
        tx.select().from(license).where(eq(license.id, licenseId)),
      );
      expect(lic).toMatchObject({ tier: "business", seatLimit: 40, amountPaidCents: 299_900 });
      expect(send).not.toHaveBeenCalled();
    });

    it("ignores a downgrade, same tier and revoked licenses; throws for bad or unknown ones", async () => {
      const { licenseId } = await mintLicense({ tier: "business" });
      expect(await handleStripeEvent(upgrade(licenseId, "team"))).toBe("ignored");
      expect(await handleStripeEvent(upgrade(licenseId, "business"))).toBe("ignored");

      const revoked = await mintLicense({ tier: "starter" });
      await withPlatform((tx) =>
        tx.update(license).set({ status: "revoked" }).where(eq(license.id, revoked.licenseId)),
      );
      expect(await handleStripeEvent(upgrade(revoked.licenseId, "team"))).toBe("ignored");

      await expect(
        handleStripeEvent(upgrade("7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11", "team")),
      ).rejects.toThrow(/unknown license/);
      await expect(handleStripeEvent(upgrade("not-a-uuid", "team"))).rejects.toThrow(/Bad upgrade/);
    });
  });

  describe("refunds and chargebacks", () => {
    it("a full refund revokes the license and signs the tenant out; a partial refund does not", async () => {
      const p = purchase();
      const send = vi.fn(async (_e: Email) => {});
      await handleStripeEvent(p.event, { send, appUrl: APP_URL });
      const act = await activate(keyFrom(send.mock.calls[0]![0]), "Refund Co");
      if (!act.ok) throw new Error("activation failed");
      const { token } = await createSession({ tenantId: act.tenantId, userId: act.userId });
      expect((await validateSession(token)).ok).toBe(true);

      const partial = evt("charge.refunded", {
        payment_intent: p.pi,
        amount: 129_900,
        amount_refunded: 5_000,
      });
      expect(await handleStripeEvent(partial)).toBe("ignored");
      expect((await licenseByPi(p.pi))!.status).toBe("active");

      const full = evt("charge.refunded", {
        payment_intent: p.pi,
        amount: 129_900,
        amount_refunded: 129_900,
      });
      expect(await handleStripeEvent(full)).toBe("processed");
      expect((await licenseByPi(p.pi))!.status).toBe("revoked");
      expect(await validateSession(token)).toEqual({ ok: false, reason: "license_inactive" });
    });

    it("dispute opened suspends; won restores; lost revokes", async () => {
      const send = vi.fn(async (_e: Email) => {});
      const a = purchase();
      await handleStripeEvent(a.event, { send, appUrl: APP_URL });

      const opened = () => evt("charge.dispute.created", { payment_intent: a.pi });
      const closed = (status: string) =>
        evt("charge.dispute.closed", { payment_intent: a.pi, status });

      expect(await handleStripeEvent(opened())).toBe("processed");
      expect((await licenseByPi(a.pi))!.status).toBe("suspended");

      // Won while never activated: back to issued.
      expect(await handleStripeEvent(closed("won"))).toBe("processed");
      expect((await licenseByPi(a.pi))!.status).toBe("issued");

      expect(await handleStripeEvent(opened())).toBe("processed");
      expect(await handleStripeEvent(closed("lost"))).toBe("processed");
      expect((await licenseByPi(a.pi))!.status).toBe("revoked");

      // Nothing matches an unknown payment intent.
      expect(
        await handleStripeEvent(evt("charge.dispute.created", { payment_intent: "pi_unknown" })),
      ).toBe("ignored");
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
      expect(await licenseByPi(p.pi)).toBeUndefined();
    });

    it("a correctly signed purchase mints a license and queues the email", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
      vi.stubEnv("RESEND_API_KEY", "");
      vi.stubEnv("APP_URL", APP_URL);
      const p = purchase();
      const body = JSON.stringify({ ...p.event, object: "event" });

      const res = await post(body, { "stripe-signature": signed(body) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, outcome: "processed" });
      expect(await licenseByPi(p.pi)).toMatchObject({ status: "issued", tier: "team" });
      expect(getOutbox().some((m) => m.to === p.email)).toBe(true);

      // Stripe redelivers: still 200, still one license.
      const again = await post(body, { "stripe-signature": signed(body) });
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ received: true, outcome: "duplicate" });
    });

    it("returns 500 (so Stripe retries) when a valid event cannot be applied", async () => {
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
      const p = purchase({}, "platinum");
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
