# 0002 — Phase 1 auth, tenancy and licensing decisions

- **argon2id via `hash-wasm`** (WebAssembly), not a native addon. The plan hosts on Cloudflare
  Workers, which cannot load native modules. Parameters: m=19 MiB, t=2, p=1 (OWASP minimum).
- **One account per email across the platform.** Sign-in happens at a shared URL with no
  tenant context, so `system_user.email` is unique platform-wide (case-insensitive) instead of
  "unique per tenant" as the data model sketch says. An email can therefore belong to one
  business only. Revisit if per-tenant subdomains (`tenant.slug`) are introduced.
- **Pre-login lookups use two `SECURITY DEFINER` functions** (`auth_find_user_by_email`,
  `auth_find_session`) because RLS correctly hides every row until a tenant is pinned. They run
  as the owner, return at most one row and only the columns sign-in needs, and are executable by
  the app role only. Tables use `ENABLE` (not `FORCE`) row level security so the owner role used
  by migrations and these functions bypasses policies while the app role never does.
- **`system_user` must be quoted in hand-written SQL.** `SYSTEM_USER` is a keyword in
  PostgreSQL 16+; unquoted `from system_user` resolves to the function, not the table. Drizzle
  quotes it automatically.
- **Two database paths** (`src/db/client.ts`): Neon URLs use the WebSocket pool so interactive
  transactions work (`SET LOCAL` + queries; the HTTP driver cannot); any other URL uses `pg`.
  This also gives local/Docker Postgres for development and CI integration tests. Tenant data is
  reached only through `withTenant()`; `withPlatform()` has no tenant pinned and sees no tenant
  rows.
- **License key format:** 20 random Crockford base32 characters (100 bits) plus 1 checksum
  character, displayed as `CRM-XXXXX-XXXXX-XXXXX-XXXXXC` (last group has 6 characters). The
  checksum is a weighted sum mod 32 with odd weights (invertible mod 32), which catches every
  single-character typo; a unit test enumerates all of them. (A mod-31 first attempt missed
  `0` vs `Z`, which are equal mod 31, and was caught by that test.)
- **Rate limits** are a Postgres fixed window (`rate_limit` table), counted per IP and per key
  prefix, in their own transaction so failed attempts still count.
- **Integration tests** run against a throwaway Postgres service in CI with a restricted role,
  so RLS is genuinely exercised. The Neon CI branch is kept for the health check and later
  deploy-style checks.
