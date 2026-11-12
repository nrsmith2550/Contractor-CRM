# 0003 — Stripe billing decisions

- **Hosted Checkout, one-time payments** (`mode: "payment"`), never subscriptions. Prices are
  sent inline (`price_data`) from `src/lib/tiers.ts`, so no products need to exist in the Stripe
  dashboard and the code is the single source of truth for prices. Tier prices are still
  placeholders pending the pricing decision.
- **The webhook is the only thing that mints licenses.** `checkout.session.completed` (and
  `async_payment_succeeded`) with `payment_status: "paid"` creates an `issued` license. The
  success page never shows a key and cannot be used to retrieve one.
- **Authenticated by signature, not origin.** The route verifies Stripe's HMAC over the raw body
  (WebCrypto provider, so it runs on Workers). Stripe sends no Origin header, so the "extra origin
  check" in the plan does not apply to this route.
- **Idempotent and atomic.** Each event id is inserted into `stripe_event` in the same
  transaction as its effects; a redelivery is a no-op. A unique `stripe_payment_intent_id`
  also stops two different events for one payment from minting two keys.
- **The key is emailed inside the transaction, before commit.** Only a hash is stored, so a
  committed license whose email failed would be unrecoverable. If sending fails we roll back and
  return 500; Stripe retries and a fresh key is minted and sent. Without an email provider
  configured, production refuses to run rather than lose a key; development keeps mail in memory
  (optionally in `EMAIL_DEV_DIR`) and does not log it.
- **Refunds and disputes:** a full refund or a lost dispute sets the license to `revoked`; an
  opened dispute sets `suspended`; a won dispute restores `active` (if it was ever bound to a
  tenant) or `issued`. Partial refunds are ignored. Each change writes an `admin_audit_log` row
  with a null admin and the Stripe event id as the reason. Sessions already check the license on
  every request, so a revoked or suspended license signs the tenant out.
- **Upgrades** pay the price difference and raise `seat_limit`/`tier` on the same license (no new
  key); downgrades, same-tier and revoked licenses are ignored.
- **Use a dedicated, restricted key.** The server only calls `checkout.sessions.create`, so the
  key needs just _Checkout Sessions: Write_. Develop against a test-mode/sandbox account that is
  not the business's real storefront account.
