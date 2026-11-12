# CRM Build Plan (Dynamics CE–style) for Claude Code

Nov 12, 2026 · @Nate

## Overview

Build a multi-tenant, license-key-activated CRM that copies the look, terminology and workflow of Microsoft Dynamics 365 Customer Engagement (Sales + Customer Service + a light Field Service), running entirely on free-tier infrastructure.

The product is sold per business. A purchase generates a license key; the business owner opens the product URL, enters the key once, and creates their email + password. From then on they sign in normally, and the platform admin (you) can reset their credentials from a separate admin console.

**How to use this plan with Claude Code**

1. Create an empty GitHub repo and clone it locally.
2. Save this whole document as `docs/PLAN.md` in the repo (export as Markdown).
3. Paste the kickoff prompt from the "Kickoff prompt" section into Claude Code from the repo root.
4. Work one phase at a time. Each phase ends with its acceptance criteria passing and a PR merged to `main`.

**Scope in Dynamics terms**

| Dynamics CE area | What we build | Phase |
| --- | --- | --- |
| Sales: Leads | Lead capture, qualify / disqualify, lead → Account + Contact + Opportunity | 2 |
| Sales: Opportunities ("prospects") | Pipeline, stages, business process flow, est. revenue, close as won/lost | 2 |
| Customers | Accounts, Contacts, timeline of activities and notes | 2 |
| Product catalog | Products, units, price lists, discounts | 3 |
| Quotes | Quote builder, line items, tax, revisions, activate, PDF, email, win → Order | 3 |
| Customer Service | Cases (service calls), SLAs (simple), queues | 4 |
| Field Service | Work orders, bookable resources, bookings | 4 |
| Scheduling | Calendar + Schedule Board (resources × time, drag-and-drop) | 5 |
| Platform | Licensing, tenants, users, security roles, admin console, audit | 1, 6 |

## Tech stack

One TypeScript codebase on Next.js, Postgres on Neon's free plan, and Microsoft's own Fluent UI so the app looks like Dynamics out of the box.

| Layer | Choice | Why | Cost |
| --- | --- | --- | --- |
| Database | [Neon](https://neon.com/faqs/free-plan-limits-and-quotas) serverless Postgres | Free plan: 100 projects, 1 GB storage and 100 CU-hours per project per month, no card, no time limit. Upgrading is a billing change, not a migration. | $0 |
| ORM / migrations | Drizzle ORM + drizzle-kit | Typed schema, SQL migrations checked into the repo, works with Neon's serverless driver | $0 |
| App framework | Next.js (App Router) + TypeScript, pnpm | Server components, server actions and API routes in one app | $0 |
| UI | Fluent UI React v9 (`@fluentui/react-components`) | Microsoft's design system — the closest match to the Dynamics Unified Interface | $0 (MIT) |
| Grids | TanStack Table (or Fluent DataGrid) | Sortable, filterable, paged list views | $0 |
| Forms / validation | React Hook Form + Zod (shared schemas client + server) | One schema validates the UI and the API | $0 |
| Auth | Custom session auth (argon2id password hashes, DB sessions, httpOnly cookies) | The license-key activation flow is custom anyway; keeps all credentials in our own DB | $0 |
| Calendar | FullCalendar standard (MIT: day/week/month/list) | Calendar tab | $0 |
| Schedule Board | Custom grid built with dnd-kit | FullCalendar's resource timeline is a paid premium plugin, so we build the board ourselves | $0 |
| PDF quotes | `@react-pdf/renderer` | Server-side quote PDFs | $0 |
| Email | Resend free tier (password reset, quote emails) | Simple API; swap for SMTP if preferred | $0 |
| File attachments | Cloudflare R2 free tier (S3-compatible) | Notes/attachments on records | $0 |
| Payments → license | Stripe Checkout + webhook | Purchase triggers license-key generation; Stripe charges per transaction only | % per sale |
| Hosting | Cloudflare Workers via the OpenNext adapter (free plan) | See note below | $0 |
| Tests | Vitest (unit), Playwright (E2E) |  | $0 |
| CI | GitHub Actions | Lint, typecheck, test, migrate on merge | $0 for typical usage |

**Hosting note:** Vercel is the easiest host for Next.js, but its [Hobby plan is restricted to non-commercial personal use](https://vercel.com/docs/limits/fair-use-guidelines); selling licenses is commercial. Use Vercel Hobby only for private development previews, and deploy production to Cloudflare Workers (free) — or budget for Vercel Pro. Confirm Cloudflare's current free-plan limits before launch.

**Scaling note:** the free Neon project caps at 1 GB of storage, and writes that would exceed it fail until space is freed or the plan is upgraded. That comfortably covers early customers (a CRM row is usually under 2 KB); keep attachments in R2, never in Postgres.

## Licensing and sign-in

A license key is a one-time activation token: it creates the business's tenant and owner account on first use, and after that the owner signs in with email + password at the same product URL.

**Key format and storage**

- Format: `CRM-XXXXX-XXXXX-XXXXX-XXXXX` using Crockford base32 (no 0/O/1/I confusion), 100+ bits of randomness from `crypto.randomBytes`, plus a 1-character checksum to catch typos before hitting the DB.
- Store only `sha256(key)` plus the last 5 characters for display ("…-7KQ2M"). The full key is shown once at purchase and emailed to the buyer.
- Each license row carries: `tier (Starter / Team / Business / Enterprise), seat_limit, status, amount_paid_cents, stripe_payment_intent_id, activated_at, tenant_id. Licenses are perpetual, with no expiry date`.

**License states**

| Status | Meaning | Can sign in? |
| --- | --- | --- |
| `issued` | Bought, not yet activated | Activation screen only |
| `active` | Bound to a tenant | Yes |
| `suspended` | Chargeback or admin hold | No — shows "contact support" |
| `revoked` | Refunded / abuse | No |

**Tiers and pricing (one-time payment, priced by active users)**

| Tier | Active users (seats) | One-time price | Price per seat |
| --- | --- | --- | --- |
| Starter | 1–5 | $499 | \~$100 |
| Team | 6–15 | $1,299 | \~$87 |
| Business | 16–40 | $2,999 | \~$75 |
| Enterprise | 41–100 | $5,999 | \~$60 |

- Every tier includes every module (Sales, Quotes, Service, Schedule Board); tiers differ only by seat count.
- The seat limit counts active (not disabled) users. Inviting past the limit shows an "Upgrade your license" prompt.
- **Upgrades**: the owner pays the difference between tiers (e.g. Team → Business = $1,700) through Stripe Checkout from Settings → License. The webhook raises `seat_limit` on the same license; no new key.
- Over 100 users: custom quote, minted manually by the platform admin.
- Optional later: a yearly "updates and support" add-on (\~20% of license price) for recurring revenue without making the license a subscription.

**Purchase → key**

1. Buyer picks a tier on the pricing page and completes Stripe Checkout in one-time payment mode (not a subscription).
2. Stripe webhook `checkout.session.completed` (signature verified) creates a `license` row in `issued` state and emails the key.
3. The platform admin can also mint keys manually from the admin console (for demos, resellers, comps).

**First sign-in (activation) at `https://app.<yourdomain>/activate`**

1. User enters the license key. Server normalizes it, checks the checksum, looks up `sha256(key)`.
2. If `issued`: show the "Set up your business" form — company name, owner full name, owner email, password (+ confirm), time zone, currency.
3. On submit, in one DB transaction: create `tenant`, create owner `user` with argon2id password hash, assign the System Administrator security role, set license to `active` with `tenant_id` and `activated_at`, seed default data (business process stages, price list, case subjects), write an audit entry.
4. Send a verification email; sign the owner in and land on the Sales Hub dashboard.
5. If the key is already `active`: do not allow a second activation — redirect to `/login` with the email pre-hinted ("j\*\*\*@acme.com").
6. Rate-limit activation attempts per IP and per key prefix (e.g. 5 per 15 minutes) and log every failure.

**Normal sign-in at `/login`**

- Email + password → DB session (random 256-bit token, stored hashed, 30-day sliding expiry, httpOnly + Secure + SameSite=Lax cookie).
- Every request checks session → user → tenant → license `active`. A suspended license logs everyone out on next request.
- Owner can invite more users up to `seat_limit`; invitees set their own password via an emailed link.
- Self-service "Forgot password" sends a single-use, 30-minute reset token (stored hashed).

**Admin-side reset (the "housed" credentials)**

Passwords are never stored in a recoverable form — not even for the admin. "Housed for reset" means the platform keeps the owner's identity record (email, name, tenant, license) and lets the admin act on it:

- **Send reset link** to the owner's email on file (default).
- **Issue a temporary password**, shown to the admin once, with `must_change_password = true` forcing a change at next sign-in (for owners who've lost email access).
- **Change owner email** (e.g. the owner left the company), with a note required and both old and new addresses notified.
- **Re-activate**: as a last resort, return the license to a re-claimable state so the business can set a new owner via the activation screen; tenant data is preserved.
- Every admin action writes an immutable `admin_audit_log` row (who, what, when, IP, reason) and revokes the owner's existing sessions.

## Architecture and multi-tenancy

One app, one Postgres database, every business row tagged with `tenant_id` and fenced by Postgres Row-Level Security — the cheapest model that stays safe on a free tier.

**Three surfaces in one Next.js app**

| Surface | Route | Who | Auth |
| --- | --- | --- | --- |
| Marketing + checkout | `/` , `/pricing` | Public | None; Stripe Checkout |
| CRM app | `/activate`, `/login`, `/app/**` | Tenant users | Tenant session |
| Platform admin console | `/admin/**` | You (platform staff) | Separate `platform_admin` table, separate cookie, mandatory TOTP 2FA, optional IP allowlist |

**Tenant isolation (defence in depth)**

1. Every tenant-owned table has `tenant_id uuid not null` + an index starting with `tenant_id`.
2. RLS enabled on those tables with policy `tenant_id = current_setting('app.tenant_id')::uuid`.
3. A data-access helper `withTenant(tenantId, fn)` opens a transaction, runs `SET LOCAL app.tenant_id = …`, then executes queries. App code never queries tenant tables outside it.
4. The app connects as a non-superuser role that cannot bypass RLS; migrations run as the owner role.
5. An automated test signs in as tenant A and asserts every list/read/update endpoint returns nothing from tenant B.

**Code layering**

- `src/server/domain/*` — pure business logic per entity (qualify lead, recalc quote, close case). No HTTP, easily unit-tested.
- `src/server/actions/*` — Next.js server actions: auth check → security-role check → Zod parse → domain call → audit.
- `src/db/schema/*` — Drizzle tables; `src/db/migrations` generated SQL.
- `src/app/(crm)/app/**` — pages: list view (grid) and main form per entity, matching Dynamics routes like `/app/leads`, `/app/leads/[id]`.

**Security roles (Dynamics-style, simplified)**

- Seeded roles: System Administrator, Sales Manager, Salesperson, Customer Service Rep, Field Technician, Read-only.
- Privileges per entity: Create / Read / Write / Delete / Assign, each at depth User (own records) or Organization (all). Stored as JSON on the role; checked in one `can(user, entity, action, record)` helper.
- Records have `owner_id` (user or team), mirroring Dynamics ownership.

**Cross-cutting**

- Auto-numbering per tenant: `LEAD-01001`, `QUO-01001-R0`, `CAS-01001`, `WO-01001` via a `sequences` table updated with `SELECT … FOR UPDATE`.
- Audit: `audit_log` row per create/update/delete with field-level before/after JSON.
- Timeline: activities and notes attach to any record through a polymorphic `regarding_type` + `regarding_id`.

## Data model

Table names follow Dynamics entity names so the vocabulary carries over. Every tenant table also has `id uuid`, `tenant_id`, `owner_id`, `created_by`, `created_at`, `modified_by`, `modified_at`, `state_code` (Active/Inactive) and `status_code`; those are omitted below.

**Platform (not tenant-scoped)**

| Table | Key fields |
| --- | --- |
| `license` | key\_hash, key\_last5, tier, seat\_limit, status, amount\_paid\_cents, tenant\_id, stripe\_customer\_id, stripe\_payment\_intent\_id, activated\_at |
| `tenant` | name, slug, time\_zone, currency, logo\_url, settings jsonb |
| `platform_admin` | email, password\_hash, totp\_secret (encrypted), last\_login\_at |
| `admin_audit_log` | admin\_id, action, target\_type, target\_id, reason, ip, created\_at |

**Identity (tenant-scoped)**

| Table | Key fields |
| --- | --- |
| `system_user` | email (unique per tenant), full\_name, password\_hash, is\_owner, must\_change\_password, email\_verified\_at, disabled\_at |
| `session` | user\_id, token\_hash, expires\_at, ip, user\_agent |
| `password_reset_token` | user\_id, token\_hash, expires\_at, used\_at, issued\_by (self or admin) |
| `security_role`, `user_role` | name, privileges jsonb / user\_id, role\_id |
| `team`, `team_member` | name / team\_id, user\_id |

**Sales**

| Table | Key fields |
| --- | --- |
| `lead` | lead\_number, topic, first\_name, last\_name, job\_title, company\_name, email, phone, address fields, lead\_source, rating (Hot/Warm/Cold), est\_value, status\_code (New / Contacted / Qualified / Disqualified + reason), qualified\_account\_id, qualified\_contact\_id, qualified\_opportunity\_id |
| `account` | account\_number, name, primary\_contact\_id, parent\_account\_id, phone, website, industry, address fields, relationship\_type (Prospect / Customer / Vendor / Partner), credit\_limit, payment\_terms, price\_list\_id |
| `contact` | first\_name, last\_name, parent\_account\_id, job\_title, email, mobile, business\_phone, address fields, preferred\_contact\_method |
| `opportunity` | name, customer\_account\_id, customer\_contact\_id, originating\_lead\_id, price\_list\_id, est\_revenue, est\_close\_date, probability, stage (Qualify / Develop / Propose / Close), pipeline\_phase, budget, purchase\_timeframe, status\_code (Open / Won / Lost + reason), actual\_revenue, actual\_close\_date |
| `opportunity_product` | opportunity\_id, product\_id, quantity, price\_per\_unit, manual\_discount, extended\_amount |
| `competitor` (optional) | name, strengths, weaknesses |

**Product catalog**

| Table | Key fields |
| --- | --- |
| `uom_schedule`, `uom` | name / schedule\_id, name, base\_quantity |
| `product` | product\_number, name, description, product\_type (Product / Service), default\_uom\_id, standard\_cost, current\_cost, list\_price, is\_taxable |
| `price_list` | name, currency, begin\_date, end\_date |
| `price_list_item` | price\_list\_id, product\_id, uom\_id, amount, pricing\_method (Currency / % of list) |
| `discount_list`, `discount` | name, type (% / amount) / list\_id, begin\_qty, end\_qty, value |
| `tax_rate` | name, rate\_percent, region |

**Quotes and orders**

| Table | Key fields |
| --- | --- |
| `quote` | quote\_number, revision\_number, name, opportunity\_id, customer\_account\_id, customer\_contact\_id, price\_list\_id, effective\_from, effective\_to, bill\_to / ship\_to address fields, payment\_terms, freight\_amount, discount\_percent, discount\_amount, subtotal, tax\_total, total\_amount, status\_code (Draft / Active / Won / Closed-Lost / Closed-Revised), terms\_text |
| `quote_detail` | quote\_id, line\_number, product\_id or write\_in\_description, uom\_id, quantity, price\_per\_unit, manual\_discount, tax\_rate\_id, extended\_amount |
| `sales_order`, `sales_order_detail` | created from a won quote; same shape + fulfillment status |
| `invoice`, `invoice_detail` (later phase) | created from an order |

**Service**

| Table | Key fields |
| --- | --- |
| `incident` (Case) | ticket\_number, title, customer\_account\_id, customer\_contact\_id, subject\_id, case\_type (Question / Problem / Request), priority, origin (Phone / Email / Web), description, status\_code (In Progress / On Hold / Waiting on Customer / Resolved / Cancelled), resolution, sla\_due\_at, queue\_id |
| `subject`, `queue` | hierarchical case categories / work queues |
| `work_order` | wo\_number, incident\_id, service\_account\_id, primary\_incident\_type, work\_order\_type, priority, address + lat/lng, instructions, time\_window\_start, time\_window\_end, est\_duration\_min, system\_status (Unscheduled / Scheduled / In Progress / Completed / Posted / Cancelled) |
| `work_order_product`, `work_order_service` | parts and labour used, feeds an invoice |
| `bookable_resource` | name, type (User / Crew / Equipment), user\_id, home\_address, work\_hours jsonb, skills (characteristic ids), color |
| `resource_booking` | resource\_id, work\_order\_id (or any regarding record), start\_at, end\_at, booking\_status (Scheduled / Travelling / In Progress / Completed / Cancelled), notes |
| `characteristic` | skills like "HVAC certified", used to match resources to work orders |

**Activities and timeline**

| Table | Key fields |
| --- | --- |
| `activity` | activity\_type (Task / Phone Call / Email / Appointment), subject, description, regarding\_type, regarding\_id, scheduled\_start, scheduled\_end, due\_at, priority, direction, status\_code (Open / Completed / Cancelled) |
| `activity_party` | activity\_id, party\_type (to/from/required/optional), party ref |
| `annotation` (Note) | regarding\_type, regarding\_id, title, body, attachment\_key (R2), mime\_type, size |
| `saved_view` | entity, name, columns jsonb, filters jsonb, sort jsonb, is\_system, owner\_id |
| `audit_log` | entity, record\_id, action, changes jsonb, user\_id, created\_at |
| `sequence` | entity, prefix, next\_value |

## Functional modules

Each module ships a list view, a main form, a quick-create form, and the business actions below, all behaving as they do in Dynamics.

### Leads

- Views: My Open Leads, All Open Leads, Leads Opened This Week, Disqualified Leads.
- Form header: Lead Source, Rating, Status, Owner. Business process flow: **Qualify → Develop → Propose → Close** (lead only shows the Qualify stage).
- **Qualify** command: dialog to create/match Account and Contact (duplicate detection on email, phone, company name) and optionally an Opportunity; lead becomes read-only with status Qualified and links to the new records.
- **Disqualify** command with reason (Lost, Cannot Contact, No Longer Interested, Cancelled). **Reactivate** reverses it.
- Import leads from CSV with column mapping.

### Opportunities (prospects)

- Views: My Open Opportunities, Open Opportunities, Closing Next 30 Days, Won, Lost; plus a **Kanban pipeline view** by stage with drag to advance.
- Business process flow bar continues from the lead: Develop (identify stakeholders, budget, timeframe), Propose (product lines, quote), Close (presentation done, final proposal).
- Product line items with revenue either user-provided or system-calculated from lines.
- **Close as Won** / **Close as Lost** dialogs capture actual revenue, close date, competitor, reason. Won sets the Account's relationship type to Customer.
- Tab: Quotes (sub-grid) with **+ New Quote** that copies customer, price list and lines.

### Customers (Accounts and Contacts)

- Account form: Summary tab (details, primary contact, address), Timeline wall, sub-grids for Contacts, Opportunities, Quotes, Cases, Work Orders. Hierarchy view via parent account.
- Contact form: details, parent account, timeline, related opportunities and cases.
- **Prospect vs Customer** is the Account relationship type: new accounts from qualified leads start as Prospect and flip to Customer on first won opportunity or order.

### Product catalog

- Products, units, price lists with price list items, volume discount lists, tax rates. Admin-only edit by default.

### Quotes and quote creation

1. Create from an Opportunity (lines copied) or standalone from an Account.
2. **Quote builder** on the form: editable line-item grid (product lookup or write-in, unit, qty, price from price list, manual discount, tax, extended amount). Totals panel recalculates live: subtotal → quote discount (% or amount) → freight → tax → total. All money math in integer cents on the server.
3. **Activate Quote** locks it (status Active) and allows **Generate PDF** (tenant logo, addresses, lines, terms) and **Email Quote** (PDF attached, logged as an Email activity).
4. **Revise** closes the active quote as Revised and creates a copy as Draft with `revision_number + 1` (`QUO-01001-R1`).
5. **Close Quote** as Won → offers to create a Sales Order and close the opportunity as Won; as Lost → optional close of the opportunity as Lost.
6. Optional: public, tokenized "view & accept quote" link for the customer (accept stamps name, time, IP).

### Service calls (Cases and Work Orders)

- **Case**: views My Active Cases, All Active Cases, Resolved; queue assignment; priority; simple SLA (due time by priority, shown as a countdown timer and turning red when breached).
- Case commands: **Resolve Case** (resolution + billable time), **Cancel**, **Reactivate**, **Convert to Work Order**.
- **Work Order** (the on-site service call): service account, address (geocoded), incident type, instructions, estimated duration, time window, required skills, products and services used. Status flows Unscheduled → Scheduled → In Progress → Completed → Posted.
- **Book** button opens the schedule board filtered to this work order's requirements.
- Technician mobile view (`/app/my-bookings`): today's bookings, status buttons (Travelling / In Progress / Completed), notes, photos, parts used, customer signature.

### Calendar and Schedule Board

- **Calendar tab**: FullCalendar day/week/month/agenda of the signed-in user's appointments, tasks with due dates, and bookings; filter by user or team; click a slot to quick-create an Appointment.
- **Schedule Board** (Field Service style):
  - Rows = bookable resources (filter by team, skill, territory); columns = time (hourly day view, daily week view, monthly).
  - Bookings drawn as colored blocks by status; drag to move, drag the edge to resize, drag to another row to reassign.
  - Bottom pane: **Unscheduled requirements** (work orders not yet booked). Drag one onto a resource/time to create a booking and set the work order to Scheduled.
  - Overlap and outside-working-hours warnings; skills mismatch warning.
  - Right-click booking: change status, open work order, cancel booking.
  - Live updates: poll every 30 s (free) or use Postgres LISTEN/NOTIFY later.

### Activities and dashboards

- Tasks, Phone Calls, Emails (logged, not a mail client in v1), Appointments, Notes on every record's Timeline, newest first, with filters.
- Dashboards: Sales (pipeline by stage, won revenue this quarter, leads by source, my activities) and Service (active cases by priority, SLA breaches, today's bookings by resource). Charts with Recharts.

## Dynamics-style UI/UX

Recreate the Unified Interface layout and behaviours, using our own product name, logo and colors — never Microsoft's trademarks, logos or the word "Dynamics" in the UI.

- **App shell**: dark top bar (app name, global search, quick-create "+", settings gear, user avatar); collapsible left **site map** grouped as My Work (Dashboards, Activities, Calendar), Customers (Accounts, Contacts), Sales (Leads, Opportunities, Quotes, Orders), Service (Cases, Work Orders, Schedule Board), Collateral (Products, Price Lists). An area switcher at the bottom toggles Sales / Service / Settings.
- **List (grid) pages**: command bar (New, Delete, Refresh, Email a Link, Export to Excel, Import), view selector dropdown with system and personal views, column header sort/filter menus, a search box scoped to the view, row checkboxes, paging footer with record count. Column chooser and "Save as new view".
- **Main forms**: header with record title, entity name, and up to 4 key header fields; command bar (Save, Save & Close, New, Deactivate, Delete, Assign, Share, entity-specific actions like Qualify); **business process flow** chevron bar under the header with stage fly-outs holding required fields; tabs (Summary, Details, Related); three-column Summary layout with the **Timeline** in the middle column; sub-grids; lookups with typeahead and "+ New".
- **Quick create** pane sliding in from the right; **quick view** cards for a lookup's related record.
- Unsaved-changes indicator in the footer, required field red asterisks, business-recommended blue plus signs, field-level validation messages, toast notifications.
- Keyboard: Ctrl+S save, Ctrl+Shift+S save & close.
- Theming: Fluent UI tokens; tenant can set a primary brand color and logo in Settings. Light theme first, dark theme later.
- Responsive: grids collapse to card lists on mobile; technician view designed mobile-first.

## Repo structure

```text
crm/
├─ CLAUDE.md                  # conventions Claude Code must follow (see kickoff prompt)
├─ docs/PLAN.md               # this document
├─ docs/decisions/            # short ADRs for any deviation from the plan
├─ .env.example               # DATABASE_URL, DATABASE_URL_OWNER, SESSION_SECRET, STRIPE_*, RESEND_API_KEY, R2_*, APP_URL
├─ .github/workflows/ci.yml   # install → lint → typecheck → unit → migrate (test branch) → e2e
├─ drizzle.config.ts
├─ src/
│  ├─ app/
│  │  ├─ (marketing)/          # /, /pricing, /checkout/success
│  │  ├─ (auth)/               # /activate, /login, /forgot-password, /reset-password
│  │  ├─ (crm)/app/            # shell layout + entity routes
│  │  │  ├─ leads/ [id]/
│  │  │  ├─ opportunities/ accounts/ contacts/ quotes/ orders/
│  │  │  ├─ cases/ work-orders/ schedule-board/ calendar/ my-bookings/
│  │  │  ├─ products/ price-lists/ dashboards/ settings/
│  │  ├─ admin/                # platform console: licenses, tenants, owners, audit
│  │  └─ api/                  # stripe webhook, pdf, cron, health
│  ├─ components/
│  │  ├─ shell/                # TopBar, SiteMap, AreaSwitcher
│  │  ├─ grid/                 # EntityGrid, ViewSelector, CommandBar
│  │  ├─ form/                 # EntityForm, HeaderFields, BusinessProcessFlow, Lookup, SubGrid, Timeline
│  │  └─ scheduling/           # ScheduleBoard, BookingBlock, UnscheduledPane
│  ├─ entities/                 # one metadata file per entity: fields, views, form layout, commands
│  ├─ server/
│  │  ├─ auth/                 # sessions, password hashing, license activation, rate limiting
│  │  ├─ security/             # can(), role privileges
│  │  ├─ domain/               # lead.qualify, quote.recalculate, quote.revise, case.resolve, booking.create…
│  │  └─ actions/              # server actions per entity
│  ├─ db/
│  │  ├─ schema/               # drizzle tables by module
│  │  ├─ migrations/
│  │  ├─ rls.sql               # policies applied after migrations
│  │  ├─ client.ts             # withTenant()
│  │  └─ seed/                 # demo tenant with realistic data
│  └─ lib/                      # money, dates/time zones, numbering, validation schemas
├─ scripts/
│  ├─ create-admin.ts           # bootstrap the first platform admin
│  └─ mint-license.ts           # issue a key from the CLI
└─ tests/
   ├─ unit/
   └─ e2e/                      # playwright: activation, qualify, quote lifecycle, booking drag, tenant isolation
```

**Metadata-driven entities.** Each file in `src/entities/` declares fields, views, form layout and commands, and the generic `EntityGrid` / `EntityForm` render from it. That is how Dynamics works, and it means adding an entity is mostly configuration rather than new pages.

## Phased build plan

Seven phases, each a branch and PR into `main`; a phase is done only when its acceptance checks pass in CI. Phases run in order because each depends on the one before.

### Phase 0 — Foundation

Scaffold Next.js + TypeScript + pnpm, Fluent UI provider, ESLint/Prettier, Vitest, Playwright, Drizzle with Neon, GitHub Actions CI, `.env.example`, `CLAUDE.md`.

- [ ] `pnpm dev` runs; `/api/health` returns DB connectivity OK
- [ ] CI runs lint, typecheck, unit and e2e on every PR and is green
- [ ] A Neon branch is used for CI so tests never touch the main DB

### Phase 1 — Licensing, tenants, auth, admin console

License table and key generator, `/activate`, `/login`, sessions, forgot/reset password, invitations with seat limit, security roles + `can()`, RLS + `withTenant`, Stripe webhook, `/admin` with TOTP, license list (mint / suspend / revoke / extend), tenant list, owner reset actions, admin audit log.

- [ ] A minted key activates once, creates tenant + owner, and a second activation attempt redirects to login
- [ ] Wrong or malformed keys are rejected; the 6th attempt in 15 min is rate-limited
- [ ] Admin can send a reset link, issue a temp password (forced change on login) and change the owner email; each creates an audit row and kills existing sessions
- [ ] Suspending a license signs out that tenant's users on their next request
- [ ] Tenant-isolation e2e test passes (tenant A sees zero tenant B rows)
- [ ] Stripe test-mode checkout produces an `issued` license and an email

### Phase 2 — App shell + core Sales

Shell (top bar, site map, area switcher), metadata-driven `EntityGrid` and `EntityForm`, views, Timeline, activities, notes; Accounts, Contacts, Leads, Opportunities, business process flow, Qualify / Disqualify, Close as Won / Lost, pipeline Kanban, CSV import, duplicate detection, auto-numbering, audit log.

- [ ] Qualify a lead creates Account + Contact + Opportunity linked to the lead, which becomes read-only
- [ ] BPF stage advance enforces required stage fields
- [ ] Closing an opportunity as Won sets the account to Customer
- [ ] A salesperson with User-level read cannot open another user's lead

### Phase 3 — Product catalog, Quotes, Orders

Products, units, price lists, discounts, tax; opportunity product lines; quote builder, activate, revise, PDF, email, close won → sales order.

- [ ] Totals are correct to the cent across discount, freight and tax (unit tests with edge cases: 0 qty, 100% discount, rounding)
- [ ] Revise produces `-R1` as Draft and the original becomes Closed-Revised
- [ ] Active quotes are read-only; PDF renders with tenant logo
- [ ] Won quote creates an order and can close the opportunity as Won

### Phase 4 — Service: Cases and Work Orders

Cases with queues, subjects, priority, simple SLA timer, resolve/cancel/reactivate; work orders with products/services, required skills, time windows; bookable resources and working hours; technician mobile view.

- [ ] Converting a case creates a linked Unscheduled work order
- [ ] SLA timer shows breached state past due
- [ ] Technician can move a booking through Travelling → In Progress → Completed and capture a signature

### Phase 5 — Calendar and Schedule Board

FullCalendar tab; custom schedule board with resource rows, day/week/month scales, drag/move/resize/reassign, unscheduled pane, conflict and skills warnings, filters, polling refresh.

- [ ] Dragging an unscheduled work order onto a resource creates a booking and sets the work order to Scheduled
- [ ] Overlapping bookings and outside-hours drops show a warning
- [ ] Board renders 25 resources × 1 week with 300 bookings in under 1 s on a mid-range laptop

### Phase 6 — Dashboards, polish, launch

Sales and Service dashboards, export to Excel (CSV/XLSX), tenant branding, dark theme, accessibility pass (keyboard + WCAG AA contrast), seed demo tenant, production deploy to Cloudflare, backups.

- [ ] Lighthouse accessibility ≥ 90 on grid and form pages
- [ ] Production deploy from `main` via CI, with migrations applied automatically
- [ ] Restore drill: recover the DB from a Neon branch/snapshot into a test branch

## Security, testing, deployment

**Security baseline**

- Passwords: argon2id, minimum 12 characters, checked against a common-password list. Never logged, never returned by any API, never visible to admins.
- Sessions, reset tokens and license keys are stored only as hashes; comparisons are constant-time.
- CSRF: server actions + SameSite cookies; extra origin check on the Stripe webhook and admin routes.
- Rate limits on `/activate`, `/login`, `/forgot-password` (Postgres-backed counter table; no paid Redis needed).
- Security headers: CSP, HSTS, X-Frame-Options DENY, Referrer-Policy.
- Secrets only in environment variables; `.env` git-ignored; GitHub secret scanning on.
- Input validated with Zod on the server for every action; output escaped by React; PDF and CSV generation sanitize formulas (prefix `=+-@` cells).
- Dependency updates via Dependabot; `pnpm audit` in CI.

**Testing**

- Unit: domain functions (qualify, quote math, revise, SLA calc, booking conflicts, key checksum).
- Integration: server actions against a Neon test branch, including RLS isolation.
- E2E (Playwright): activation → login → create lead → qualify → quote → PDF → win; case → work order → drag-book on board; admin reset flow.

**Environments and deploy**

| Environment | Database | Host | Trigger |
| --- | --- | --- | --- |
| Local | Neon dev branch (or local Postgres via Docker) | `pnpm dev` | — |
| CI | Fresh Neon branch per run, deleted after | GitHub Actions | Every PR |
| Preview | Neon preview branch | Vercel Hobby (private, non-commercial) or Cloudflare preview | PR |
| Production | Neon main branch | Cloudflare Workers (OpenNext) | Merge to `main` |

- Migrations run in CI before deploy using the owner connection string; the app runs with a restricted role.
- Backups: rely on Neon's point-in-time history, plus a nightly `pg_dump` from a GitHub Actions cron to R2 for an off-platform copy.

## Kickoff prompt for Claude Code

Paste this into Claude Code from the repo root after saving this document as `docs/PLAN.md`. Re-use the second prompt at the start of every later phase.

**First session**

```text
You are building a multi-tenant CRM that mimics the look, terminology and workflows of
Microsoft Dynamics 365 Customer Engagement, under our own brand. The full spec is in
docs/PLAN.md — read it completely before writing code.

1. Create CLAUDE.md at the repo root containing the conventions below, then follow them.
2. Implement Phase 0 only. Stop when every Phase 0 acceptance box can be ticked,
   open a PR titled "Phase 0 — Foundation", and summarize what you built and any
   decisions you made (also record them in docs/decisions/).
3. Ask me before adding any paid service or deviating from the stack in PLAN.md.

Conventions for CLAUDE.md:
- Stack: Next.js App Router, TypeScript strict, pnpm, Fluent UI React v9, Drizzle + Neon
  Postgres, Zod, React Hook Form, Vitest, Playwright. No other UI kits.
- Every tenant table has tenant_id + RLS. All tenant queries go through withTenant().
  Never query tenant tables outside it.
- Business logic lives in src/server/domain as pure functions with unit tests.
- Server actions: auth -> can() permission check -> Zod parse -> domain -> audit log.
- Money is integer cents; dates stored UTC, shown in tenant time zone.
- Passwords argon2id; tokens/keys stored only as hashes; never log secrets.
- Entities are metadata-driven from src/entities/*. Prefer extending metadata
  over writing one-off pages.
- Do not use Microsoft logos, trademarks or the word "Dynamics" in the UI.
- Every PR: lint, typecheck, tests green; new behaviour has tests; update PLAN.md
  checkboxes for the phase.
```

**Each following phase**

```text
Read CLAUDE.md and docs/PLAN.md. Implement Phase <N> — <name> on a new branch
phase-<N>. Start by listing the tasks you will do and the files you will touch, then
build them. Write tests for every acceptance criterion first and make them pass.
When done, tick the boxes in PLAN.md, open a PR, and summarize anything you
couldn't finish or decided differently.
```

**Before Phase 1, set these up yourself (Claude Code will ask for the values):**

- [ ] Neon account and project; copy the owner and app-role connection strings
- [ ] Stripe account in test mode; create the product(s) and copy the API key + webhook secret
- [ ] Resend account and a verified sending domain
- [ ] Cloudflare account (R2 bucket now; Workers at launch)
- [ ] Domain name for `app.<yourdomain>`

## Assumptions and open decisions

**Assumptions made in this plan**

- "Sign in through the product URL" means one shared URL (`app.<yourdomain>`) where the key is entered once at `/activate`; afterwards users sign in at `/login`. Per-tenant subdomains (`acme.<yourdomain>`) can be added later without schema changes (`tenant.slug` already exists).
- "Housed for reset" means the platform stores the owner's identity and lets the admin reset access, not that it stores readable passwords. Storing recoverable passwords would be a serious security and liability risk.
- "Prospects" maps to Opportunities plus Accounts with relationship type Prospect, as in Dynamics.
- One license = one business (tenant) with a seat limit, not one license per user.

**Decisions for you**

- [ ] Confirm or adjust the tier prices and seat ranges (current figures are placeholders)
- [ ] Refund window for one-time purchases (e.g. 30 days, which revokes the key)
- [ ] Product name, logo and brand color
- [ ] Offer the optional yearly updates-and-support add-on at launch, or later?
- [ ] Do customers need email integration (send/receive from the CRM) in v1, or is logging emails enough?
- [ ] Hosting at launch: Cloudflare Workers (free) or Vercel Pro (simpler, paid)?

**Sources**

- [Neon — Free plan limits and quotas](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Neon — Free to production on the same plan architecture](https://neon.com/faqs/postgres-services-free-to-production)
- [Vercel — Fair use guidelines (Hobby commercial restriction)](https://vercel.com/docs/limits/fair-use-guidelines)
- [Vercel — Hobby plan](https://vercel.com/docs/accounts/plans/hobby)
