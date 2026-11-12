# 0004 — Activation and sign-in pages

- **Forms:** React Hook Form with a Zod resolver, using the same schemas the server actions parse
  (`src/lib/validation/auth.ts`), so a form and its endpoint cannot disagree. Server actions
  return a field-level error (or a banner) instead of throwing; success redirects.
- **Session cookie:** `crm_session`, httpOnly, SameSite=Lax, Secure in production, path `/`.
  It carries only the random token (hashed in the database). The database is the authority on
  validity and does the 30-day sliding expiry; the cookie itself is long-lived because a server
  component cannot refresh a cookie. (The `__Host-` prefix was not used so local http development
  and tests behave the same as production.)
- **Every `/app/**` request** re-validates session → user → tenant → license in the layout, so a
  suspended or revoked license signs the tenant out on its next request, and a forced password
  change redirects to `/change-password` before anything else.
- **Login hardening:** attempts count against the IP and against a hash of the email (so no
  address is stored in the counter table); unknown-email and wrong-password cost the same time
  (a dummy argon2 verify) and give one generic message; a disabled account or inactive license is
  only revealed after the correct password.
- **Client IP** comes from `CF-Connecting-IP` (set by Cloudflare's edge), then `X-Real-IP`, then
  the _rightmost_ `X-Forwarded-For` entry, never the leftmost, which the caller controls.
- **Redirect safety:** `?next=` is only honoured for paths under `/app`.
- **Security headers** (X-Frame-Options DENY, nosniff, Referrer-Policy, HSTS, Permissions-Policy)
  are set in `next.config.ts`. A Content-Security-Policy is deferred: Fluent UI injects styles
  and Next injects inline scripts, so a useful CSP needs a per-request nonce (middleware).
- **E2E in CI** runs against the Postgres service container with the restricted role; the Neon CI
  branch is still created and migrated to prove the migrations apply on Neon.
- **Not yet built:** the email-verification message sent at activation (needs a token table and
  the Resend account), forgot/reset password, and invitations.
