# Test hosting on Vercel (Hobby, free)

Hobby is for non-commercial use: fine for testing and demos, not for a paid product
(see `docs/decisions/` and the hosting notes in the PR thread). Each deploy runs
`pnpm vercel-build`, which applies migrations + RLS (owner role) and then builds.

## 1. Database (Neon)

Use the existing Neon project. You need two roles on the same database:

- **owner** (runs migrations) -> `DATABASE_URL_OWNER`
- **restricted app role** (no `BYPASSRLS`) -> `DATABASE_URL`, and its role name -> `APP_DB_ROLE`

Use the **pooled** connection strings from the Neon dashboard (Connect).

## 2. Import the repo

Vercel -> Add New -> Project -> import `nrsmith2550/Contractor-CRM`. Leave framework as Next.js.

## 3. Environment variables (Project -> Settings -> Environment Variables)

| Name                                         | Value                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL_OWNER`                         | owner connection string                                                                                                 |
| `DATABASE_URL`                               | restricted-role connection string                                                                                       |
| `APP_DB_ROLE`                                | restricted role name                                                                                                    |
| `SESSION_SECRET`                             | `openssl rand -base64 48`                                                                                               |
| `ADMIN_TOTP_KEY`                             | `openssl rand -base64 32`                                                                                               |
| `APP_URL`                                    | your Vercel URL, e.g. `https://your-app.vercel.app` (no trailing slash)                                                 |
| `RESEND_API_KEY`, `EMAIL_FROM`               | optional for first tests; without them password-reset and invitation emails cannot be sent (production refuses to send) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | optional; only for the pricing/checkout page                                                                            |

Set `APP_URL` after the first deploy shows your URL, then redeploy.

## 4. First license and admin

Run from your machine with the same two DB URLs exported (see `.env.example`):

```bash
pnpm license:mint --tier team          # prints a license key (shown once)
# platform admin (optional): see the header of scripts/create-admin.ts
pnpm admin:create
```

Then open `<APP_URL>/activate` and paste the key.

## Notes

- Activation and sign-in hash passwords with WASM argon2; Hobby functions have enough CPU for this.
  If a request times out, say so and we will look at the hash cost.
- Stripe webhook (optional): `<APP_URL>/api/stripe/webhook`, signing secret -> `STRIPE_WEBHOOK_SECRET`.
