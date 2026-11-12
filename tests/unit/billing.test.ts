import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TIER_IDS, TIERS, formatUsd, isTier, upgradePriceCents } from "@/lib/tiers";
import { createPurchaseCheckout, createUpgradeCheckout } from "@/server/billing/checkout";
import { getOutbox, sendEmail } from "@/server/email/mailer";
import { licenseKeyEmail } from "@/server/email/templates";

type Params = Stripe.Checkout.SessionCreateParams;

function fakeStripe(url: string | null = "https://checkout.stripe.test/pay/cs_1") {
  const create = vi.fn(async (_params: Params) => ({ url }));
  return {
    stripe: { checkout: { sessions: { create } } } as unknown as Pick<Stripe, "checkout">,
    create,
  };
}

describe("tiers", () => {
  it("matches the plan's seat ranges and one-time prices", () => {
    expect(TIER_IDS).toEqual(["starter", "team", "business", "enterprise"]);
    expect(TIERS.starter).toMatchObject({ seatLimit: 5, priceCents: 49_900 });
    expect(TIERS.team).toMatchObject({ seatLimit: 15, priceCents: 129_900 });
    expect(TIERS.business).toMatchObject({ seatLimit: 40, priceCents: 299_900 });
    expect(TIERS.enterprise).toMatchObject({ seatLimit: 100, priceCents: 599_900 });
    expect(formatUsd(129_900)).toBe("$1,299");
  });

  it("upgrades cost the difference (Team → Business = $1,700)", () => {
    expect(upgradePriceCents("team", "business")).toBe(170_000);
    expect(upgradePriceCents("starter", "enterprise")).toBe(550_000);
  });

  it("rejects downgrades and same-tier 'upgrades'", () => {
    expect(() => upgradePriceCents("business", "team")).toThrow();
    expect(() => upgradePriceCents("team", "team")).toThrow();
  });

  it("recognises only real tiers", () => {
    expect(isTier("team")).toBe(true);
    expect(isTier("platinum")).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });
});

describe("purchase checkout", () => {
  it("creates a one-time payment (never a subscription) at the tier price", async () => {
    const { stripe, create } = fakeStripe();
    const url = await createPurchaseCheckout(stripe, { tier: "team", appUrl: "https://app.test" });
    expect(url).toBe("https://checkout.stripe.test/pay/cs_1");

    const p = create.mock.calls[0]![0];
    expect(p.mode).toBe("payment");
    expect(p.customer_creation).toBe("always");
    expect(p.line_items).toHaveLength(1);
    expect(p.line_items![0]).toMatchObject({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: 129_900 },
    });
    expect(p.metadata).toEqual({ kind: "purchase", tier: "team" });
    expect(p.payment_intent_data?.metadata).toEqual({ kind: "purchase", tier: "team" });
    expect(p.success_url).toBe(
      "https://app.test/checkout/success?session_id={CHECKOUT_SESSION_ID}",
    );
    expect(p.cancel_url).toBe("https://app.test/pricing");
    expect(JSON.stringify(p)).not.toMatch(/recurring|subscription/i);
  });

  it("fails loudly if Stripe returns no URL", async () => {
    const { stripe } = fakeStripe(null);
    await expect(
      createPurchaseCheckout(stripe, { tier: "starter", appUrl: "https://app.test" }),
    ).rejects.toThrow(/checkout URL/);
  });
});

describe("upgrade checkout", () => {
  const base = { licenseId: "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11", appUrl: "https://app.test" };

  it("charges only the difference and tags the license and target tier", async () => {
    const { stripe, create } = fakeStripe();
    await createUpgradeCheckout(stripe, {
      ...base,
      fromTier: "team",
      toTier: "business",
      stripeCustomerId: "cus_123",
    });
    const p = create.mock.calls[0]![0];
    expect(p.mode).toBe("payment");
    expect(p.line_items![0]).toMatchObject({ price_data: { unit_amount: 170_000 } });
    expect(p.metadata).toEqual({ kind: "upgrade", licenseId: base.licenseId, toTier: "business" });
    expect(p.customer).toBe("cus_123");
    expect(p.customer_creation).toBeUndefined();
  });

  it("creates a customer when the license has none, and refuses non-upgrades", async () => {
    const { stripe, create } = fakeStripe();
    await createUpgradeCheckout(stripe, { ...base, fromTier: "starter", toTier: "team" });
    expect(create.mock.calls[0]![0].customer_creation).toBe("always");
    await expect(
      createUpgradeCheckout(stripe, { ...base, fromTier: "team", toTier: "starter" }),
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("license email", () => {
  it("contains the key and the activation link, and escapes HTML", () => {
    const email = licenseKeyEmail({
      to: "buyer@example.test",
      key: "CRM-AAAAA-BBBBB-CCCCC-DDDDDD",
      tier: "business",
      appUrl: "https://app.test/",
    });
    expect(email.to).toBe("buyer@example.test");
    expect(email.subject).toContain("Business");
    expect(email.text).toContain("CRM-AAAAA-BBBBB-CCCCC-DDDDDD");
    expect(email.text).toContain("https://app.test/activate");
    expect(email.html).toContain("CRM-AAAAA-BBBBB-CCCCC-DDDDDD");

    const evil = licenseKeyEmail({
      to: "x@example.test",
      key: "<script>alert(1)</script>",
      tier: "team",
      appUrl: 'https://app.test"><b>',
    });
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).not.toContain('"><b>');
  });
});

describe("mailer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("keeps mail in memory (not logs) when no provider is configured outside production", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "test");
    const before = getOutbox().length;
    await sendEmail({ to: "a@example.test", subject: "Hi", text: "secret-body" });
    expect(getOutbox().length).toBe(before + 1);
    expect(getOutbox().at(-1)).toMatchObject({ to: "a@example.test", subject: "Hi" });
  });

  it("refuses to run without a provider in production, so a key is never silently lost", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await expect(sendEmail({ to: "a@example.test", subject: "Hi", text: "x" })).rejects.toThrow(
      /RESEND_API_KEY/,
    );
  });

  it("requires EMAIL_FROM when a provider key is set, and surfaces provider errors", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "");
    await expect(sendEmail({ to: "a@example.test", subject: "Hi", text: "x" })).rejects.toThrow(
      /EMAIL_FROM/,
    );

    vi.stubEnv("EMAIL_FROM", "CRM <licenses@example.test>");
    const fetchMock = vi.fn(async () => new Response("nope", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail({ to: "a@example.test", subject: "Hi", text: "x" })).rejects.toThrow(
      /422/,
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
  });
});
