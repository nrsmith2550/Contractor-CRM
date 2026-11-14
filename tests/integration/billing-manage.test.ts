import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withPlatform, withTenant } from "@/db/client";
import { auditLog, license } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import type { Api } from "@/server/billing/account";
import {
  beginCardUpdate,
  billingView,
  changePlan,
  completeCardUpdate,
  previewPlanChange,
  setCancel,
} from "@/server/billing/manage";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { mintLicense } from "@/server/licensing/mint";
import { DEFAULT_ROLES } from "@/server/security/roles";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const PERIOD_END = 1_900_000_000;

type Stored = {
  id: string;
  customer: string;
  edition: string;
  extraUsers: number;
  cancel: boolean;
};

/** A fake Stripe that holds one subscription and answers the way Stripe does after each change. */
function fakeStripe(s: Stored) {
  const sub = () => ({
    id: s.id,
    customer: s.customer,
    status: "active",
    cancel_at_period_end: s.cancel,
    metadata: { kind: "subscription", edition: s.edition, extraUsers: String(s.extraUsers) },
    default_payment_method: {
      id: "pm_1",
      card: { brand: "visa", last4: "4242", exp_month: 1, exp_year: 2031 },
    },
    items: {
      data: [
        {
          id: "si_plan",
          quantity: 1,
          current_period_end: PERIOD_END,
          price: { id: "p1", product: { metadata: { role: "plan" } } },
        },
        ...(s.extraUsers
          ? [
              {
                id: "si_seats",
                quantity: s.extraUsers,
                current_period_end: PERIOD_END,
                price: { id: "p2", product: { metadata: { role: "seats" } } },
              },
            ]
          : []),
      ],
    },
  });
  const retrieved: string[] = [];
  const update = vi.fn(async (_id: string, params: Record<string, unknown>) => {
    const md = params.metadata as Record<string, string> | undefined;
    if (md) {
      s.edition = md.edition!;
      s.extraUsers = Number(md.extraUsers);
    }
    if (typeof params.cancel_at_period_end === "boolean") s.cancel = params.cancel_at_period_end;
    return sub();
  });
  const raw = {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        retrieved.push(id);
        return sub();
      }),
      update,
    },
    invoices: {
      list: vi.fn(async () => ({ data: [] })),
      createPreview: vi.fn(async () => ({
        lines: {
          data: [{ amount: 1_250, parent: { subscription_item_details: { proration: true } } }],
        },
      })),
      pay: vi.fn(),
    },
    invoiceItems: { create: vi.fn(async () => ({ id: "ii_1" })), del: vi.fn() },
    prices: {
      list: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async (p: { lookup_key: string }) => ({ id: `price_${p.lookup_key}` })),
    },
    setupIntents: {
      create: vi.fn(async () => ({ client_secret: "seti_1_secret_x" })),
      retrieve: vi.fn(async (_id: string): Promise<unknown> => ({
        id: "seti_1",
        status: "succeeded",
        customer: s.customer,
        payment_method: "pm_new",
        metadata: { purpose: "update_card", subscription: s.id },
      })),
    },
    customers: { update: vi.fn(async (_id: string, _p: unknown) => ({})) },
  };
  return { stripe: raw as unknown as Api, update, retrieved, raw };
}

async function activate(label: string) {
  const id = rand();
  const { key } = await mintLicense({ edition: "deals" });
  return { id, key, label };
}

/** A business that bought on the site: an activated licence with a subscription behind it. */
async function subscribedBusiness(
  over: { edition?: "complete" | "deals" | "jobs"; extra?: number } = {},
) {
  const id = rand();
  const stored: Stored = {
    id: `sub_${id}`,
    customer: `cus_${id}`,
    edition: over.edition ?? "complete",
    extraUsers: over.extra ?? 0,
    cancel: false,
  };
  const { key } = await mintLicense({
    edition: over.edition ?? "complete",
    extraUsers: stored.extraUsers,
    seatLimit: 10 + stored.extraUsers,
    stripeCustomerId: stored.customer,
    stripeSubscriptionId: stored.id,
    billingStatus: "active",
  });
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Billing Co ${id}`,
    ownerName: "Pat Owner",
    ownerEmail: `owner-${id}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "America/New_York",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error("activation failed");
  const ctx = await buildCtx(res.tenantId, res.userId);
  return { ctx, stored, tenantId: res.tenantId, ...fakeStripe(stored) };
}

const licenseOf = async (tenantId: string) =>
  (await withPlatform((tx) => tx.select().from(license).where(eq(license.tenantId, tenantId))))[0]!;

const auditActions = async (tenantId: string) =>
  (
    await withTenant(tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.entity, "license")),
    )
  ).map((a) => a.action);

/** The same business, seen by someone whose role has no billing access (a Sales Manager). */
const asSalesManager = (ctx: Ctx): Ctx => ({
  ...ctx,
  subject: {
    ...ctx.subject,
    privileges: DEFAULT_ROLES.find((r) => r.name === "Sales Manager")!.privileges,
  },
});

describe.skipIf(!enabled)("Billing page operations (real Postgres, fake Stripe)", () => {
  it("shows the owner their plan, card, invoices and how many people are signed up", async () => {
    const b = await subscribedBusiness({ extra: 5 });
    const r = await billingView(b.ctx, { stripe: b.stripe });
    if (!r.ok) throw new Error(r.message);
    expect(r.view.overview).toMatchObject({
      status: "active",
      edition: "complete",
      extraUsers: 5,
      seats: 15,
      monthlyCents: 9_500,
      card: { last4: "4242" },
    });
    expect(r.view.activeUsers).toBe(1);
    expect(r.view.invoices).toEqual([]);
  });

  it("only people who can manage the licence may see or change anything, and Stripe is never called", async () => {
    const b = await subscribedBusiness();
    const other = asSalesManager(b.ctx);
    const results = [
      await billingView(other, { stripe: b.stripe }),
      await previewPlanChange(other, { edition: "complete", extraUsers: 3 }, { stripe: b.stripe }),
      await changePlan(other, { edition: "complete", extraUsers: 3 }, { stripe: b.stripe }),
      await setCancel(other, true, { stripe: b.stripe }),
      await beginCardUpdate(other, { stripe: b.stripe }),
      await completeCardUpdate(other, "seti_1", { stripe: b.stripe }),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(b.raw.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(b.update).not.toHaveBeenCalled();
  });

  it("a business that is not billed through the site has nothing to manage", async () => {
    const { id, key } = await activate("manual");
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Manual Co ${id}`,
      ownerName: "Pat Owner",
      ownerEmail: `owner-${id}@example.test`,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      timeZone: "America/New_York",
      currency: "USD",
      ip: `ip-${id}`,
    });
    if (!res.ok) throw new Error("activation failed");
    const ctx = await buildCtx(res.tenantId, res.userId);
    const { stripe, raw } = fakeStripe({
      id: "x",
      customer: "y",
      edition: "deals",
      extraUsers: 0,
      cancel: false,
    });
    expect(await billingView(ctx, { stripe })).toMatchObject({ ok: false, code: "unavailable" });
    expect(await changePlan(ctx, { edition: "complete", extraUsers: 0 }, { stripe })).toMatchObject(
      { ok: false, code: "unavailable" },
    );
    expect(raw.subscriptions.update).not.toHaveBeenCalled();
  });

  it("only ever reads and changes its own business's subscription, never another's", async () => {
    const a = await subscribedBusiness();
    const b = await subscribedBusiness();
    await changePlan(a.ctx, { edition: "complete", extraUsers: 4 }, { stripe: a.stripe });
    await billingView(a.ctx, { stripe: a.stripe });
    expect(new Set(a.retrieved)).toEqual(new Set([a.stored.id]));
    expect(b.retrieved).toEqual([]);
    expect((await licenseOf(b.tenantId)).extraUsers).toBe(0);
  });

  it("refuses a subscription that turns out to belong to a different customer", async () => {
    const a = await subscribedBusiness();
    a.stored.customer = "cus_somebody_else"; // Stripe says the subscription is someone else's
    const r = await setCancel(a.ctx, true, { stripe: a.stripe });
    expect(r).toMatchObject({ ok: false, code: "forbidden" });
    expect(a.update).not.toHaveBeenCalled();
  });

  it("previews the cost of a change without changing anything", async () => {
    const b = await subscribedBusiness();
    const r = await previewPlanChange(
      b.ctx,
      { edition: "complete", extraUsers: 6 },
      { stripe: b.stripe },
    );
    if (!r.ok) throw new Error(r.message);
    expect(r.preview).toMatchObject({
      dueNowCents: 1_250,
      nextMonthlyCents: 7_000 + 6 * 500,
      seats: 16,
    });
    expect(b.update).not.toHaveBeenCalled();
    expect((await licenseOf(b.tenantId)).extraUsers).toBe(0);
  });

  it("adding people changes the licence at once, so they can be invited straight away, and is recorded", async () => {
    const b = await subscribedBusiness();
    const r = await changePlan(b.ctx, { edition: "complete", extraUsers: 6 }, { stripe: b.stripe });
    expect(r.ok).toBe(true);
    expect(await licenseOf(b.tenantId)).toMatchObject({
      edition: "complete",
      extraUsers: 6,
      seatLimit: 16,
      billingStatus: "active",
    });
    expect(await auditActions(b.tenantId)).toContain("billing.change_plan");
  });

  it("moving to a smaller plan narrows the business to that plan straight away", async () => {
    const b = await subscribedBusiness({ edition: "complete" });
    const r = await changePlan(b.ctx, { edition: "deals", extraUsers: 0 }, { stripe: b.stripe });
    expect(r.ok).toBe(true);
    expect(await licenseOf(b.tenantId)).toMatchObject({ edition: "deals", seatLimit: 10 });
  });

  it("refuses choices it cannot sell and leaves everything as it was", async () => {
    const b = await subscribedBusiness();
    for (const bad of [
      { edition: "platinum", extraUsers: 1 },
      { edition: "complete", extraUsers: 41 },
      { edition: "complete", extraUsers: 0 }, // already what they have
    ]) {
      expect(await changePlan(b.ctx, bad, { stripe: b.stripe })).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
    expect(b.update).not.toHaveBeenCalled();
    expect(await auditActions(b.tenantId)).not.toContain("billing.change_plan");
  });

  it("a refused card is reported plainly and nothing changes", async () => {
    const b = await subscribedBusiness();
    b.update.mockRejectedValueOnce(
      Object.assign(new Error("declined"), { type: "StripeCardError", code: "card_declined" }),
    );
    const r = await changePlan(b.ctx, { edition: "complete", extraUsers: 6 }, { stripe: b.stripe });
    expect(r).toMatchObject({ ok: false, code: "conflict" });
    expect((r as { message: string }).message).toContain("card was not accepted");
    expect((await licenseOf(b.tenantId)).extraUsers).toBe(0);
  });

  it("an unexpected Stripe failure is a calm message, not an error page, and does not leak details", async () => {
    const b = await subscribedBusiness();
    b.raw.subscriptions.retrieve.mockRejectedValueOnce(new Error("sk_test_secret exploded"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await billingView(b.ctx, { stripe: b.stripe });
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(r)).not.toContain("sk_test");
    spy.mockRestore();
  });

  it("cancelling schedules the end of the paid period, keeps working until then, and can be undone", async () => {
    const b = await subscribedBusiness();
    expect((await setCancel(b.ctx, true, { stripe: b.stripe })).ok).toBe(true);
    expect(await licenseOf(b.tenantId)).toMatchObject({
      cancelAtPeriodEnd: true,
      status: "active",
    });
    expect((await setCancel(b.ctx, false, { stripe: b.stripe })).ok).toBe(true);
    expect((await licenseOf(b.tenantId)).cancelAtPeriodEnd).toBe(false);
    expect(await auditActions(b.tenantId)).toEqual(
      expect.arrayContaining(["billing.cancel_at_period_end", "billing.resume"]),
    );
  });

  it("updates the card: a one-use form, then the new card becomes the one used", async () => {
    const b = await subscribedBusiness();
    const start = await beginCardUpdate(b.ctx, { stripe: b.stripe });
    expect(start).toMatchObject({ ok: true, clientSecret: "seti_1_secret_x" });
    const done = await completeCardUpdate(b.ctx, "seti_1", { stripe: b.stripe });
    expect(done).toMatchObject({ ok: true, retriedOverdue: false });
    expect(b.raw.customers.update).toHaveBeenCalledWith(b.stored.customer, {
      invoice_settings: { default_payment_method: "pm_new" },
    });
    expect(await auditActions(b.tenantId)).toContain("billing.update_card");
  });

  it("will not take a card form that was not made for this business", async () => {
    const b = await subscribedBusiness();
    b.raw.setupIntents.retrieve.mockResolvedValueOnce({
      id: "seti_x",
      status: "succeeded",
      customer: "cus_someone_else",
      payment_method: "pm_x",
      metadata: { purpose: "update_card", subscription: "sub_other" },
    });
    expect(await completeCardUpdate(b.ctx, "seti_x", { stripe: b.stripe })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(b.raw.customers.update).not.toHaveBeenCalled();
    for (const bad of ["", "pi_123", "seti_1; drop", 42, null]) {
      expect(await completeCardUpdate(b.ctx, bad, { stripe: b.stripe })).toMatchObject({
        ok: false,
        code: "invalid",
      });
    }
  });
});
