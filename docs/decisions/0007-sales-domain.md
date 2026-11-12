# 0007 — Sales domain (Phase 2, slice 1)

- **Records are owned.** Leads, accounts, contacts, opportunities, activities and notes carry
  `owner_id`; security roles grant each action at _user_ (own records) or _organization_ depth.
  Every domain function resolves the acting user's privileges once (`buildCtx`) and applies `can()`
  against the record's owner; list queries add the same restriction in SQL (`readScope`), so a
  user-level reader can't see, count or search other people's records. Tenant isolation is a separate,
  deeper layer (Postgres RLS), tested independently.
- **"Not found" vs "forbidden".** A record the user may not even read is reported as _not found_, so
  its existence isn't revealed; one they may read but not change is _forbidden_.
- **Circular references have no foreign keys.** lead ↔ opportunity (`originating_lead_id`,
  `qualified_*`) and account ↔ contact (`primary_contact_id`, `parent_account_id`) are plain uuids; the
  domain layer keeps them consistent and RLS fences every read.
- **Auto-numbering** (`LEAD-01001`, `ACC-`, `CON-`, `OPP-`) uses one `UPDATE … RETURNING` on the tenant's
  `sequence` row, which serialises concurrent creates (a test creates 12 at once) and gives numbers back
  if a create rolls back. Sequences are seeded at activation.
- **Qualify** (one transaction): creates or reuses the Account and Contact and, optionally, an
  Opportunity; links them; locks the lead as read-only. If matching accounts/contacts already exist
  (company name ignoring case/punctuation, email, last 10 digits of a phone) and the caller hasn't said
  what to do, nothing is created and the matches are returned for the user to choose between reusing
  one and creating a new record.
- **Business process flow** (`bpf.ts`, pure): Qualify → Develop → Propose → Close. Forward moves are one
  stage at a time and require the current stage's fields (Qualify: topic, account, close date; Develop:
  contact, budget, timeframe; Propose: revenue, proposal delivered); backward moves are always allowed.
  The response names the missing fields. Probability follows the stage when moving forward.
- **Close as Won** sets the account to _Customer_ as a platform rule, applied directly rather than
  through the salesperson's own account permissions (they may not have write access to that account).
  Won and lost opportunities are read-only until reopened.
- **Updates** only touch the fields supplied: `""`/`null` clears a field, an omitted field is left alone,
  and the topic can be changed but not cleared. Every write records a field-level before/after audit row;
  a no-op update records nothing.
- **Money is integer cents** (`bigint`), including CSV import ("$12,500.50" → 1250050).
- **CSV import** goes row by row through the normal `createLead` path (same validation, numbering,
  ownership and audit), reports bad rows by spreadsheet row number, and still imports the good ones. The
  CSV writer neutralises spreadsheet formulas (`= + - @`) for export.
- **Not in this slice:** the app shell, the metadata-driven grid and form, the pages for these records,
  the Kanban board UI and the import screen. The domain layer is complete and tested first so the UI is a
  thin layer over it.
