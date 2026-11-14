import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
  BillingError,
  applyChange,
  finishCardUpdate,
  listInvoices,
  overview,
  previewChange,
  setCancelAtPeriodEnd,
  startCardUpdate,
  type Account,
  type Api,
} from "@/server/billing/account";

const PERIOD_END = 1_900_000_000;

const account = (over: Partial<Account> = {}): Account => ({
  edition: "complete",
  extraUsers: 5,
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: "sub_1",
  billingStatus: "active",
  ...over,
});

/** A subscription as Stripe returns it with the product expanded on each line. */
function subscription(over: Record<string, unknown> = {}, opts: { seats?: number | null } = {}) {
  const seats = opts.seats === undefined ? 5 : opts.seats;
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { kind: "subscription", edition: "complete", extraUsers: String(seats ?? 0) },
    default_payment_method: {
      id: "pm_old",
      card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 },
    },
    items: {
      data: [
        {
          id: "si_plan",
          quantity: 1,
          current_period_end: PERIOD_END,
          price: { id: "price_inline_plan", product: { metadata: { role: "plan" } } },
        },
        ...(seats
          ? [
              {
                id: "si_seats",
                quantity: seats,
                current_period_end: PERIOD_END,
                price: { id: "price_inline_seats", product: { metadata: { role: "seats" } } },
              },
            ]
          : []),
      ],
    },
    ...over,
  };
}

type Line = { amount: number; proration: boolean };

function fakeStripe(
  sub: ReturnType<typeof subscription> = subscription(),
  opts: {
    lines?: Line[];
    existingPrices?: Record<string, { id: string; unit_amount: number }>;
    updateError?: unknown;
  } = {},
) {
  const calls = {
    update: vi.fn(async (_id: string, params: Record<string, unknown>) => ({
      ...sub,
      ...params,
      metadata: { ...sub.metadata, ...(params.metadata as object | undefined) },
    })),
    preview: vi.fn(async (_p: Record<string, unknown>) => ({
      lines: {
        data: (opts.lines ?? []).map((l) => ({
          amount: l.amount,
          parent: { subscription_item_details: { proration: l.proration } },
        })),
      },
    })),
    invoiceItemCreate: vi.fn(async (_p: Record<string, unknown>) => ({ id: "ii_setup" })),
    invoiceItemDel: vi.fn(async (_id: string) => ({})),
    priceCreate: vi.fn(async (p: Record<string, unknown>) => ({
      id: `price_new_${p.lookup_key}`,
    })),
    pay: vi.fn(async (_id: string, _p: unknown) => ({})),
    customerUpdate: vi.fn(async (_id: string, _p: unknown) => ({})),
    setupCreate: vi.fn(async (_p: Record<string, unknown>) => ({ client_secret: "seti_secret" })),
    setupRetrieve: vi.fn(async (_id: string): Promise<unknown> => ({})),
  };
  if (opts.updateError) calls.update.mockRejectedValueOnce(opts.updateError);
  const stripe = {
    subscriptions: { retrieve: vi.fn(async () => sub), update: calls.update },
    invoices: {
      list: vi.fn(async () => ({
        data: [
          {
            id: "in_1",
            number: "ABC-0001",
            created: 1_800_000_000,
            total: 57_000,
            status: "paid",
            invoice_pdf: "https://pay.stripe.test/in_1.pdf",
          },
        ],
      })),
      createPreview: calls.preview,
      pay: calls.pay,
    },
    invoiceItems: { create: calls.invoiceItemCreate, del: calls.invoiceItemDel },
    prices: {
      list: vi.fn(async (p: { lookup_keys: string[] }) => {
        const have = opts.existingPrices?.[p.lookup_keys[0]!];
        return { data: have ? [have] : [] };
      }),
      create: calls.priceCreate,
    },
    setupIntents: { create: calls.setupCreate, retrieve: calls.setupRetrieve },
    customers: { update: calls.customerUpdate },
  } as unknown as Api;
  return { stripe, calls };
}

const itemsOf = (call: ReturnType<typeof vi.fn>) =>
  (
    (call.mock.calls[0]![0] as Record<string, unknown>).subscription_details as {
      items: unknown[];
    }
  ).items;

describe("reading the subscription", () => {
  it("shows the plan, people, price, renewal date and card", async () => {
    const { stripe } = fakeStripe();
    expect(await overview(stripe, account())).toEqual({
      status: "active",
      edition: "complete",
      extraUsers: 5,
      seats: 15,
      monthlyCents: 7_000 + 5 * 500,
      periodEnd: new Date(PERIOD_END * 1000),
      cancelAtPeriodEnd: false,
      card: { brand: "visa", last4: "4242", expMonth: 4, expYear: 2030 },
    });
  });

  it("says past due, cancelled and scheduled cancellation as they are", async () => {
    const past = await overview(
      fakeStripe(subscription({ status: "past_due", cancel_at_period_end: true })).stripe,
      account(),
    );
    expect(past).toMatchObject({ status: "past_due", cancelAtPeriodEnd: true });
    const gone = await overview(fakeStripe(subscription({ status: "canceled" })).stripe, account());
    expect(gone.status).toBe("canceled");
  });

  it("copes with no card on file", async () => {
    const o = await overview(
      fakeStripe(subscription({ default_payment_method: null })).stripe,
      account(),
    );
    expect(o.card).toBeNull();
  });

  it("refuses a subscription that is not this business's", async () => {
    const other = fakeStripe(subscription({ customer: "cus_someone_else" }));
    await expect(overview(other.stripe, account())).rejects.toMatchObject({ code: "not_yours" });
    await expect(setCancelAtPeriodEnd(other.stripe, account(), true)).rejects.toBeInstanceOf(
      BillingError,
    );
    expect(other.calls.update).not.toHaveBeenCalled();
  });

  it("lists invoices with their downloadable copy", async () => {
    const rows = await listInvoices(fakeStripe().stripe, account());
    expect(rows).toEqual([
      {
        id: "in_1",
        number: "ABC-0001",
        date: new Date(1_800_000_000 * 1000),
        totalCents: 57_000,
        status: "paid",
        pdfUrl: "https://pay.stripe.test/in_1.pdf",
      },
    ]);
  });
});

describe("previewing a change", () => {
  it("adding people changes only the quantity and charges the prorated part now", async () => {
    const { stripe, calls } = fakeStripe(subscription(), {
      lines: [
        { amount: 1_000, proration: true },
        { amount: 500, proration: true },
        { amount: 9_999, proration: false }, // next month's full charge: not "due now"
      ],
    });
    const p = await previewChange(stripe, account(), { edition: "complete", extraUsers: 15 }, 3);
    expect(itemsOf(calls.preview)).toEqual([{ id: "si_seats", quantity: 15 }]);
    expect(calls.priceCreate).not.toHaveBeenCalled(); // same plan: no new price needed
    expect(p).toEqual({
      dueNowCents: 1_500,
      creditCents: 0,
      nextMonthlyCents: 7_000 + 15 * 500,
      seats: 25,
      setupDifferenceCents: 0,
    });
  });

  it("moving up to Complete adds the setup fee difference once and swaps both prices", async () => {
    const sub = subscription({
      metadata: { kind: "subscription", edition: "deals", extraUsers: "5" },
    });
    const { stripe, calls } = fakeStripe(sub, { lines: [{ amount: 800, proration: true }] });
    const p = await previewChange(
      stripe,
      account({ edition: "deals", extraUsers: 5 }),
      { edition: "complete", extraUsers: 5 },
      3,
    );
    expect(itemsOf(calls.preview)).toEqual([
      { id: "si_plan", price: "price_new_gantry_plan_complete" },
      { id: "si_seats", price: "price_new_gantry_seats_complete", quantity: 5 },
    ]);
    expect(p.setupDifferenceCents).toBe(20_000); // $500 - $300
    expect(p.dueNowCents).toBe(20_800);
  });

  it("moving down gives a credit and never a setup charge or refund", async () => {
    const { stripe } = fakeStripe(subscription(), { lines: [{ amount: -2_500, proration: true }] });
    const p = await previewChange(stripe, account(), { edition: "deals", extraUsers: 5 }, 3);
    expect(p).toMatchObject({ dueNowCents: 0, creditCents: 2_500, setupDifferenceCents: 0 });
  });

  it("dropping to the included people removes the people line; adding them back adds one", async () => {
    const down = fakeStripe(subscription(), { lines: [{ amount: -1_000, proration: true }] });
    await previewChange(down.stripe, account(), { edition: "complete", extraUsers: 0 }, 3);
    expect(itemsOf(down.calls.preview)).toEqual([{ id: "si_seats", deleted: true }]);

    const up = fakeStripe(
      subscription({ metadata: { edition: "complete", extraUsers: "0" } }, { seats: null }),
      { lines: [{ amount: 400, proration: true }] },
    );
    await previewChange(
      up.stripe,
      account({ extraUsers: 0 }),
      { edition: "complete", extraUsers: 2 },
      3,
    );
    expect(itemsOf(up.calls.preview)).toEqual([
      { price: "price_new_gantry_seats_complete", quantity: 2 },
    ]);
  });

  it("reuses a price it already made, and makes a new one only when the amount changed", async () => {
    const same = fakeStripe(subscription({ metadata: { edition: "deals", extraUsers: "5" } }), {
      lines: [],
      existingPrices: {
        gantry_plan_complete: { id: "price_have_plan", unit_amount: 7_000 },
        gantry_seats_complete: { id: "price_have_seats", unit_amount: 100 }, // stale amount
      },
    });
    await previewChange(
      same.stripe,
      account({ edition: "deals" }),
      { edition: "complete", extraUsers: 5 },
      3,
    );
    expect(itemsOf(same.calls.preview)).toEqual([
      { id: "si_plan", price: "price_have_plan" },
      { id: "si_seats", price: "price_new_gantry_seats_complete", quantity: 5 },
    ]);
    expect(same.calls.priceCreate).toHaveBeenCalledTimes(1);
    expect(same.calls.priceCreate.mock.calls[0]![0]).toMatchObject({
      unit_amount: 500,
      lookup_key: "gantry_seats_complete",
      transfer_lookup_key: true,
      recurring: { interval: "month" },
      product_data: { metadata: { role: "seats", edition: "complete" } },
    });
  });

  it("refuses nonsense, a no-op, and fewer people than are signed up", async () => {
    const { stripe, calls } = fakeStripe();
    for (const bad of [
      null,
      { edition: "platinum", extraUsers: 1 },
      { edition: "complete", extraUsers: 41 },
      { edition: "complete", extraUsers: 1.5 },
    ]) {
      await expect(previewChange(stripe, account(), bad, 3)).rejects.toMatchObject({
        code: "invalid",
      });
    }
    await expect(
      previewChange(stripe, account(), { edition: "complete", extraUsers: 5 }, 3),
    ).rejects.toMatchObject({ code: "unchanged" });
    // 12 people are signed up, so 10 is not enough.
    await expect(
      previewChange(stripe, account(), { edition: "complete", extraUsers: 0 }, 12),
    ).rejects.toMatchObject({ code: "below_active_users" });
    expect(calls.preview).not.toHaveBeenCalled();
  });
});

describe("making a change", () => {
  it("updates the lines and records what was bought, charging the difference now", async () => {
    const { stripe, calls } = fakeStripe();
    await applyChange(stripe, account(), { edition: "complete", extraUsers: 12 }, 3);
    expect(calls.update).toHaveBeenCalledWith("sub_1", {
      items: [{ id: "si_seats", quantity: 12 }],
      metadata: { kind: "subscription", edition: "complete", extraUsers: "12" },
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
    });
    expect(calls.invoiceItemCreate).not.toHaveBeenCalled();
  });

  it("charges the setup fee difference on the same invoice when moving up", async () => {
    const sub = subscription({
      metadata: { kind: "subscription", edition: "jobs", extraUsers: "5" },
    });
    const { stripe, calls } = fakeStripe(sub);
    await applyChange(
      stripe,
      account({ edition: "jobs" }),
      { edition: "complete", extraUsers: 5 },
      3,
    );
    expect(calls.invoiceItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_1",
        subscription: "sub_1",
        amount: 20_000,
        currency: "usd",
      }),
    );
  });

  it("if the card is refused, nothing is left charged or changed", async () => {
    const sub = subscription({
      metadata: { kind: "subscription", edition: "deals", extraUsers: "5" },
    });
    const declined = Object.assign(new Error("declined"), {
      type: "StripeCardError",
      code: "card_declined",
    });
    const { stripe, calls } = fakeStripe(sub, { updateError: declined });
    await expect(
      applyChange(stripe, account({ edition: "deals" }), { edition: "complete", extraUsers: 5 }, 3),
    ).rejects.toMatchObject({ code: "payment_failed" });
    expect(calls.invoiceItemDel).toHaveBeenCalledWith("ii_setup");
  });

  it("an unexpected Stripe error is passed up, and a pending setup charge is still removed", async () => {
    const sub = subscription({
      metadata: { kind: "subscription", edition: "deals", extraUsers: "5" },
    });
    const { stripe, calls } = fakeStripe(sub, { updateError: new Error("boom") });
    await expect(
      applyChange(stripe, account({ edition: "deals" }), { edition: "complete", extraUsers: 5 }, 3),
    ).rejects.toThrow("boom");
    expect(calls.invoiceItemDel).toHaveBeenCalledTimes(1);
  });

  it("will not touch Stripe for a choice it refuses", async () => {
    const { stripe, calls } = fakeStripe();
    await expect(
      applyChange(stripe, account(), { edition: "complete", extraUsers: 0 }, 14),
    ).rejects.toMatchObject({ code: "below_active_users" });
    expect(calls.update).not.toHaveBeenCalled();
  });
});

describe("cancelling", () => {
  it("only ever schedules the end of the paid period, and can be undone", async () => {
    const { stripe, calls } = fakeStripe();
    await setCancelAtPeriodEnd(stripe, account(), true);
    await setCancelAtPeriodEnd(stripe, account(), false);
    expect(calls.update.mock.calls).toEqual([
      ["sub_1", { cancel_at_period_end: true }],
      ["sub_1", { cancel_at_period_end: false }],
    ]);
  });
});

describe("updating the card", () => {
  const intent = (over: Record<string, unknown> = {}) => ({
    id: "seti_1",
    status: "succeeded",
    customer: "cus_1",
    payment_method: "pm_new",
    metadata: { purpose: "update_card", subscription: "sub_1" },
    ...over,
  });
  const withIntent = (i: unknown, sub = subscription()) => {
    const f = fakeStripe(sub);
    f.calls.setupRetrieve.mockResolvedValue(i);
    return f;
  };

  it("starts a one-use card form for this customer only", async () => {
    const { stripe, calls } = fakeStripe();
    expect(await startCardUpdate(stripe, account())).toBe("seti_secret");
    expect(calls.setupCreate.mock.calls[0]![0]).toMatchObject({
      customer: "cus_1",
      usage: "off_session",
      metadata: { purpose: "update_card", subscription: "sub_1" },
    });
  });

  it("makes the new card the one used for the customer and the subscription", async () => {
    const { stripe, calls } = withIntent(intent());
    expect(await finishCardUpdate(stripe, account(), "seti_1")).toEqual({ retriedOverdue: false });
    expect(calls.customerUpdate).toHaveBeenCalledWith("cus_1", {
      invoice_settings: { default_payment_method: "pm_new" },
    });
    expect(calls.update).toHaveBeenCalledWith("sub_1", {
      default_payment_method: "pm_new",
      expand: ["latest_invoice"],
    });
    expect(calls.pay).not.toHaveBeenCalled();
  });

  it("when a payment was overdue, tries the open invoice again with the new card", async () => {
    const sub = subscription({ latest_invoice: { id: "in_open", status: "open" } });
    const f = withIntent(intent(), sub);
    expect(
      await finishCardUpdate(f.stripe, account({ billingStatus: "past_due" }), "seti_1"),
    ).toEqual({ retriedOverdue: true });
    expect(f.calls.pay).toHaveBeenCalledWith("in_open", { payment_method: "pm_new" });
  });

  it("a card that is still declined does not fail the update", async () => {
    const sub = subscription({ latest_invoice: { id: "in_open", status: "open" } });
    const f = withIntent(intent(), sub);
    f.calls.pay.mockRejectedValueOnce(new Error("declined"));
    expect(
      await finishCardUpdate(f.stripe, account({ billingStatus: "past_due" }), "seti_1"),
    ).toEqual({ retriedOverdue: false });
    expect(f.calls.customerUpdate).toHaveBeenCalled();
  });

  it("refuses someone else's card form, a different purpose, or one that did not succeed", async () => {
    for (const bad of [
      intent({ customer: "cus_other" }),
      intent({ metadata: { purpose: "something_else", subscription: "sub_1" } }),
      intent({ metadata: { purpose: "update_card", subscription: "sub_other" } }),
      intent({ status: "requires_action" }),
      intent({ payment_method: null }),
    ]) {
      const f = withIntent(bad);
      await expect(finishCardUpdate(f.stripe, account(), "seti_1")).rejects.toMatchObject({
        code: "not_yours",
      });
      expect(f.calls.customerUpdate).not.toHaveBeenCalled();
      expect(f.calls.update).not.toHaveBeenCalled();
    }
  });
});
