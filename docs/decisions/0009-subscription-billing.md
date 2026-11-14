# 0009: Subscription billing with Stripe, paid for on our own pages

Status: accepted (replaces the one-time purchase model in 0003)

## Decision

- A purchase is one Stripe **subscription** with up to three lines: the plan every month, the extra
  people every month (only when there are any), and the one-time setup fee on the first invoice.
  Prices are sent inline from `src/lib/plans.ts`, so nothing has to be created in the Stripe
  dashboard and the code stays the only place prices are written down.
- Buying uses **embedded checkout** (`ui_mode: embedded_page`, `redirect_on_completion: never`):
  the payment form is drawn inside Gantry and the buyer never leaves. The same goes for the account
  options (change plan or people, update card, invoices, cancel), which are built as Gantry screens
  over the Stripe API rather than linking to Stripe's hosted portal.
- The webhook never trusts the order events arrive in. Every subscription event re-reads the
  subscription from Stripe and brings the licence in line with it (plan, people, renewal date,
  scheduled cancellation, billing status). The plan and people are recorded in the subscription's
  metadata when it is created and updated whenever they change.
- A **cancelled** subscription suspends the licence (the business is signed out on its next
  request). A **failed payment** only flags it: Stripe keeps retrying, and the owner can fix the
  card. A subscription that becomes active again restores only a licence billing itself suspended,
  never one an administrator suspended or revoked.
- Chargebacks are matched by Stripe customer: opened suspends, lost revokes, won restores. Refunds
  are handled by hand (the owner decides what a refund means for access).
- The licence key is only emailed, never shown on the thank-you page, and is minted in the same
  transaction as the event record, with the email sent before commit, so a licence without a
  delivered key cannot exist.

## Account options (Settings, Billing)

Owner-only (`license` write). Everything is scoped to the business's own subscription, looked up from
its licence, never from a browser-supplied id. Changing plan or people previews the cost (Stripe's
invoice preview, prorations only, plus the setup fee difference when moving up), then charges the
difference now with `error_if_incomplete`, so a refused card changes nothing. People cannot go below
those signed up. The card is replaced with a SetupIntent and Payment Element drawn in the page, and an
overdue invoice is retried with the new card. Cancelling only schedules the end of the paid period.
A cancelled subscription suspends the licence, so those people cannot sign in to fix it; they contact us.

## Safety

- `getStripe()` refuses a live key (`sk_live_`, `rk_live_`) unless `STRIPE_ALLOW_LIVE=true`, so a
  live key pasted into development or a preview can never charge anyone.
- The price is never taken from the browser: the checkout action takes only a plan and a whole
  number of extra people (0 to 40), validates both, and rebuilds the lines from the plan table.
  Checkout creation is rate limited per address.
- Everything is built against a **separate test-mode Stripe account**, with a restricted key.

## Not covered

- Stripe Tax is not set up, so prices are taken as shown, with no sales tax added.
- Refunds, and anything over 50 people, are handled by hand.
- Real Stripe has not been exercised yet: the tests use fabricated events and fake Stripe objects.
  The first run against a test-mode account is a go-live step.
