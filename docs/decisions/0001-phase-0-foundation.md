# 0001 — Phase 0 foundation decisions

- **ESLint 8 + `.eslintrc.json`** with `next lint`, for a stable Next 15 setup. Revisit when
  `next lint` is retired.
- **Fluent UI via a client `Providers` component** (`FluentProvider`, `webLightTheme`).
  Server-side style extraction (Griffel SSR) is deferred; it can cause a brief unstyled flash
  and will be handled when the app shell is built in Phase 2.
- **Health check** is `select 1` through the Neon HTTP driver. Returns 503 with
  `db: "not_configured"` when `DATABASE_URL` is unset, so local dev without a database still
  boots.
- **CI Neon branch** is created per run with `neondatabase/create-branch-action` and deleted
  after. It needs repo secrets `NEON_PROJECT_ID`, `NEON_API_KEY`, `NEON_APP_ROLE`; the Neon steps
  are skipped when `NEON_PROJECT_ID` is absent, so the pipeline stays green until they are added.
- **Repo**: built in a dedicated empty repository rather than the existing Softwash CRM repo.
