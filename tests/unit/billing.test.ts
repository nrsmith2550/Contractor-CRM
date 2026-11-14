import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_EXTRA_USERS, PLANS, monthlyCentsFor } from "@/lib/plans";
import {
  createSubscriptionCheckout,
  metadataFor,
  purchaseLineItems,
} from "@/server/billing/checkout";
import { assertKeyAllowed, keyMode } from "@/server/billing/stripe";
import { getOutbox, sendEmail } from "@/server/email/mailer";
import { licenseKeyEmail } from "@/server/email/templates";

type Params = Stripe.Checkout.SessionCreateParams;

function fakeStripe(secret: string | null = "cs_test_secret_123") {
  const create = vi.fn(async (_params: Params) => ({ client_secret: secret }));
  return {
    stripe: { checkout: { sessions: { create } } } as unknown as Pick<Stripe, "checkout">,
    create,
  };
}

const unit = (l: Stripe.Checkout.SessionCreateParams.LineItem) => l.price_data!.unit_amount!;
const monthlyTotal = (lines: Stripe.Checkout.SessionCreateParams.LineItem[]) =>
  lines
    .filter((l) => l.price_data?.recurring)
    .reduce((sum, l) => sum + unit(l) * (l.quantity ?? 1), 0);

describe("purchase lines", () => {
  it("Complete with 10 people: monthly plan plus one-time setup, nothing for extra people", () => {
    const lines = purchaseLineItems({ edition: "complete", extraUsers: 0 });
    expect(lines).toHaveLength(2);
    expect(monthlyTotal(lines)).toBe(7_000);
    const setup = lines.find((l) => !l.price_data?.recurring)!;
    expect(unit(setup)).toBe(50_000);
    expect(setup.quantity).toBe(1);
  });

  it("adds a monthly line for extra people, priced per plan", () => {
    const lines = purchaseLineItems({ edition: "deals", extraUsers: 5 });
    expect(lines).toHaveLength(3);
    const seats = lines.find((l) => l.price_data?.product_data?.metadata?.role === "seats")!;
    expect(seats.quantity).toBe(5);
    expect(unit(seats)).toBe(PLANS.deals.extraUserCents);
    expect(monthlyTotal(lines)).toBe(4_500 + 5 * 300);
  });

  it("always matches the price the pricing page shows, for every plan and size", () => {
    for (const edition of ["complete", "deals", "jobs"] as const) {
      for (const extraUsers of [0, 1, 5, 15, MAX_EXTRA_USERS]) {
        const lines = purchaseLineItems({ edition, extraUsers });
        expect(monthlyTotal(lines)).toBe(monthlyCentsFor(edition, extraUsers));
      }
    }
  });

  it("charges the setup fee once: it is the only line without a recurring interval", () => {
    const lines = purchaseLineItems({ edition: "jobs", extraUsers: 3 });
    expect(lines.filter((l) => !l.price_data?.recurring)).toHaveLength(1);
  });
});

describe("embedded checkout", () => {
  it("creates a subscription shown on our own page, with no redirect to Stripe", async () => {
    const { stripe, create } = fakeStripe();
    const secret = await createSubscriptionCheckout(stripe, { edition: "complete", extraUsers: 4 });
    expect(secret).toBe("cs_test_secret_123");

    const p = create.mock.calls[0]![0];
    expect(p.mode).toBe("subscription");
    expect(p.ui_mode).toBe("embedded_page");
    expect(p.redirect_on_completion).toBe("never");
    expect(p).not.toHaveProperty("success_url");
    expect(p.metadata).toEqual({ kind: "subscription", edition: "complete", extraUsers: "4" });
    expect(p.subscription_data?.metadata).toEqual(p.metadata);
    expect(p.metadata).toEqual(metadataFor({ edition: "complete", extraUsers: 4 }));
  });

  it("refuses anything that is not a real plan and a whole number of people in range", async () => {
    const { stripe, create } = fakeStripe();
    for (const bad of [
      null,
      {},
      { edition: "platinum", extraUsers: 0 },
      { edition: "complete", extraUsers: -1 },
      { edition: "complete", extraUsers: 1.5 },
      { edition: "complete", extraUsers: MAX_EXTRA_USERS + 1 },
      { edition: "complete", extraUsers: "3" },
    ]) {
      await expect(createSubscriptionCheckout(stripe, bad)).rejects.toThrow();
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("fails loudly if Stripe returns no client secret", async () => {
    const { stripe } = fakeStripe(null);
    await expect(
      createSubscriptionCheckout(stripe, { edition: "jobs", extraUsers: 0 }),
    ).rejects.toThrow(/client secret/);
  });
});

describe("stripe keys", () => {
  it("tells test and live keys apart, including restricted keys", () => {
    expect(keyMode("sk_test_abc")).toBe("test");
    expect(keyMode("rk_test_abc")).toBe("test");
    expect(keyMode("sk_live_abc")).toBe("live");
    expect(keyMode("rk_live_abc")).toBe("live");
    expect(keyMode("nonsense")).toBe("unknown");
  });

  it("refuses a live key unless live mode was switched on on purpose", () => {
    expect(() => assertKeyAllowed("sk_live_abc", undefined)).toThrow(/STRIPE_ALLOW_LIVE/);
    expect(() => assertKeyAllowed("sk_live_abc", "yes")).toThrow();
    expect(() => assertKeyAllowed("sk_live_abc", "true")).not.toThrow();
    expect(() => assertKeyAllowed("sk_test_abc", undefined)).not.toThrow();
  });
});

describe("license email", () => {
  it("names the plan, the number of people, the key and the activation link, and escapes HTML", () => {
    const email = licenseKeyEmail({
      to: "buyer@example.test",
      key: "CRM-AAAAA-BBBBB-CCCCC-DDDDDD",
      edition: "complete",
      extraUsers: 5,
      appUrl: "https://app.test/",
    });
    expect(email.to).toBe("buyer@example.test");
    expect(email.subject).toContain("Gantry Complete");
    expect(email.text).toContain("up to 15 users");
    expect(email.text).toContain("CRM-AAAAA-BBBBB-CCCCC-DDDDDD");
    expect(email.text).toContain("https://app.test/activate");
    expect(email.html).toContain("CRM-AAAAA-BBBBB-CCCCC-DDDDDD");

    const evil = licenseKeyEmail({
      to: "x@example.test",
      key: "<script>alert(1)</script>",
      edition: "deals",
      extraUsers: 0,
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

  it("EMAIL_DEV_DIR is an explicit file transport that works even in a production build", async () => {
    const { mkdtemp, readdir, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/crm-mail-`);
    try {
      vi.stubEnv("RESEND_API_KEY", "");
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("EMAIL_DEV_DIR", dir);
      await sendEmail({
        to: "dev@example.test",
        subject: "Hi",
        text: "body https://x.test?token=abc",
      });
      const files = await readdir(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/-dev@example\.test\.txt$/);
      expect(await readFile(`${dir}/${files[0]}`, "utf8")).toContain("token=abc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
