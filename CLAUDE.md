# CLAUDE.md

Multi-tenant CRM that mimics the look, terminology and workflows of a Dynamics-style
customer engagement suite, under our own brand. Full spec: `docs/PLAN.md` (read it before
starting any phase).

## Conventions

- Stack: Next.js App Router, TypeScript strict, pnpm, Fluent UI React v9, Drizzle + Neon
  Postgres, Zod, React Hook Form, Vitest, Playwright. No other UI kits.
- Every tenant table has `tenant_id` + RLS. All tenant queries go through `withTenant()`.
  Never query tenant tables outside it.
- Business logic lives in `src/server/domain` as pure functions with unit tests.
- Server actions: auth -> `can()` permission check -> Zod parse -> domain -> audit log.
- Money is integer cents; dates stored UTC, shown in tenant time zone.
- Passwords argon2id; tokens/keys stored only as hashes; never log secrets.
- Entities are metadata-driven from `src/entities/*`. Prefer extending metadata over
  writing one-off pages.
- Do not use Microsoft logos, trademarks or the word "Dynamics" in the UI.
- Every PR: lint, typecheck, tests green; new behaviour has tests; update `docs/PLAN.md`
  checkboxes for the phase.
- Ask before adding any paid service or deviating from the stack. Record deviations in
  `docs/decisions/`.

## Commands

`pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e` · `pnpm build`
`pnpm db:generate` (create migration) · `pnpm db:migrate` (apply, owner role)
