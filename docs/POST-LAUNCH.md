# After Phase 6: making Clinch CRM its own product

Written from the product owner's direction once the Dynamics-style functionality was complete.
Items marked **(proposal)** are my suggestions and need a yes/no before they are built.

## Direction

The functionality now matches a customer engagement suite. Clinch CRM is for **small businesses,
contractors, sole proprietors and small brands (clothing, etc.)**. So the next work is making it
simpler, friendlier and easier to adopt, not adding enterprise features.

## 1. Simpler names and easier steps

Goal: nothing in the product should need a CRM glossary, and each task should be a short guided
path. Terminology changes only affect labels (the data model and permissions keep their internal
names), so it is a metadata change in `src/entities/*` plus page headings.

**(proposal) Plain-language names**

| Now                   | Proposed              | Notes                                  |
| --------------------- | --------------------- | -------------------------------------- |
| Lead                  | Prospect              | someone who might buy                  |
| Qualify (a lead)      | Turn into a customer  | creates the customer, contact and deal |
| Account               | Customer (or Company) |                                        |
| Contact               | Person                |                                        |
| Opportunity           | Deal                  |                                        |
| Business process flow | Progress bar          | stages shown as plain steps            |
| Case                  | Support request       |                                        |
| Work order            | Job                   |                                        |
| Bookable resource     | Team member / crew    |                                        |
| Booking               | Visit                 |                                        |
| Schedule board        | Schedule              |                                        |
| Price lists           | Pricing               |                                        |
| Products              | Products and services |                                        |

**(proposal) Industry vocabulary packs.** One setting at sign-up ("What kind of business are you?")
swaps the labels: contractors see Customer / Estimate / Job / Crew; a clothing brand sees Customer /
Order / Product / Wholesale buyer. Same engine, different words.

**Easier steps**

- A first-run checklist on the home page ("Add your logo, add your first customer, send your first
  quote") that disappears when done.
- Forms show only the essentials first, with "More details" for the rest.
- Every empty list explains what it is for and offers the one next action (add / import).
- One "+ New" menu everywhere instead of per-list command bars.
- Plain error messages with the fix ("Add an email or phone number so we can find duplicates").

## 2. A suite of products

The license tiers already exist (`src/lib/tiers.ts`). **(proposal)** Package the modules so a
customer buys only what they run their business on, with the shared customer list underneath:

| Product                | Contains                                                                            | Typical buyer            |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------ |
| Clinch Contacts (core) | customers, people, notes, tasks, import/export                                      | everyone                 |
| Clinch Sales           | prospects, deals, pipeline, quotes, orders, sales dashboard                         | any seller               |
| Clinch Jobs            | jobs, crew, schedule, visits, technician phone view, invoices from parts and labour | contractors, trades      |
| Clinch Support         | support requests, due times, support dashboard                                      | service businesses       |
| Clinch Shop            | products, price lists, orders, wholesale accounts                                   | clothing / retail brands |
| Clinch Suite           | everything                                                                          | growing teams            |

Technically this is feature flags per license, the site map and permissions hiding what a license
does not include, and upgrade prompts. Pricing and billing stay deferred (no payment setup yet).

## 3. Easy import from existing systems

Today there is a CSV lead import with column mapping. **(proposal)** Expand it into an Import
Center with downloadable templates and "coming from..." presets:

- **Templates:** a blank Clinch spreadsheet for each of customers, people, prospects, deals,
  products, with an example row and a notes sheet.
- **Presets that recognise another system's export** and pre-map the columns: Excel/Google Sheets
  (generic), HubSpot, Salesforce, Zoho, Pipedrive, Mailchimp, QuickBooks customers, Shopify
  customers and products, Square, Google Contacts, Outlook/iPhone contacts, Jobber, Housecall Pro.
- **Safe by default:** a preview of the first rows, a duplicate check against what is already there,
  row-by-row error report you can download and fix, and an "undo this import" that removes exactly
  what it created.
- Import customers first, then people linked to them, then deals, with ids carried across so links
  survive.

## 4. Look and feel

- Name: **Clinch CRM**. Palette: deep navy sidebar, warm orange accent, soft light page (from the
  supplied mockup). Light, dark and follow-the-device themes are done (Phase 6).
- Principles: the next action is always the most obvious thing on screen; one primary button per
  page; big readable text and click targets (phone-first for field work); plain words; consistent
  places for things; never colour alone for meaning; keyboard and screen-reader friendly.
- Still to do: icons in the sidebar and tiles, the real logo file, friendlier empty states, a
  guided first-run, and a mobile bottom bar for field staff.

## Suggested order

1. Finish Phase 6 (accessibility pass, demo data, backups, production deploy).
2. Plain names + vocabulary packs (small, high impact, low risk).
3. Import Center with templates (the main adoption blocker).
4. First-run checklist and simpler forms.
5. Product packaging (feature flags per license) and the suite pages.
6. Visual polish: icons, logo, empty states, mobile bar.

## Decisions so far

1. **Names:** the proposed plain-language names are approved (Prospect, Customer, Person, Deal, Support
   request, Job, Team member, Visit, Schedule, Pricing, Products and services).
2. **First customers' systems:** not known yet (no marketing so far). So the Import Center starts with
   the generic Excel/CSV templates plus a "map your own columns" step, and system-specific presets are
   added as real customers ask for them.
3. **Suite:** not decided which product sells first. Direction: **one app and one dashboard for
   everyone**; the license decides how much of it is switched on. A module a license does not include
   stays visible but locked, with a short "what you'd get" note and an upgrade prompt, so customers
   can grow into it without moving to a different product.
4. **Logo:** supplied and now in the app (`public/brand/`, favicons in `src/app/`). Its lettering is
   black, so it always sits on a light plate (sidebar, sign-in pages).

## Still open

- Final names and prices for the license levels (and what each unlocks).
- Which module sets are bundled together at each level.
