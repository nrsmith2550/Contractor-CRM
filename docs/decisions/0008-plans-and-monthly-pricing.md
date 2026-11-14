# 0008 — Plans (Complete, Deals, Jobs) and monthly pricing

Requested by the owner. Supersedes the "one-time payment, priced by users" model in 0003 for how
the product is **sold**; the Stripe code from 0003 is kept but dormant.

## The plans

| Plan            | Unlocks      | Setup (once) | Monthly |
| --------------- | ------------ | ------------ | ------- |
| Clinch Complete | Deals + Jobs | $500         | $70     |
| Clinch Deals    | Deals only   | $300         | $45     |
| Clinch Jobs     | Jobs only    | $300         | $45     |

- The $300 + $45 price is for **each** single area on its own, so Complete is cheaper than buying
  both. Prices and contents live in `src/lib/plans.ts` and nowhere else.
- **Names:** "Deals" and "Jobs" instead of Sales and Service, to stay clear of the Microsoft
  Dynamics 365 Sales / Customer Service product names (owner's choice).
- **Users:** every plan includes **10** users (`USERS_INCLUDED`). The limit is `license.seat_limit`,
  so any licence can be given a different number from the admin console without a code change. A
  price for extra users has deliberately not been invented.

## How it is enforced

- `license.edition` (`complete | deals | jobs`, migration 0010, existing licences become
  `complete`) is the source of truth. `license.tier` stays as a legacy column and no longer decides
  anything the customer sees.
- **`loadSubject()` removes the privileges of the area the plan does not include** (`limitToEdition`).
  Every permission check in the app already goes through `can()` / `readScope()` from those
  privileges, so lists, record pages, server actions, exports, dashboards, search and related
  records all follow the plan without each knowing about it. The owner's System Administrator role
  is limited too.
- Shared parts belong to every plan: customers, people, products, pricing, tax, notes, calls, tasks,
  the calendar, dashboards, users, roles, branding, import/export, help.
- On top of that, `guardArea()` / `guardEntity()` send people who type an address for the other
  half to a plain "Your plan" page instead of an error, and the menu, Home tiles and quick actions
  show only what the plan includes.
- **A plan change takes effect on the next request** (the plan is read each time), and **nothing is
  deleted**: moving down hides the other half's data, moving back up shows it again.
- The platform admin picks the plan when minting a licence and can change it (audited as
  `license.update_plan`, with the old and new plan in the reason).

## Billing is manual for now

**No payment is taken anywhere in the product.** The public pricing page has no checkout; a
customer gets in touch and a licence key is issued from the admin console. Monthly billing means
a Stripe _subscription_ (a recurring price plus a setup fee), which is a different flow from the
one-time checkout in 0003. It is deferred until payments are set up (the owner said not to set
anything up for payments yet). Until then:

- the old one-time `checkout` code and tests remain but nothing links to them;
- an unpaid or cancelled customer is handled by **suspending** the licence in the admin console,
  which signs the whole business out on its next request (existing behaviour).

## Rejected

- Gating only in the menu: hiding links is not enforcement; the server would still serve the data.
- A per-page check on every route: it would have to be remembered for each new page. Privileges
  are checked everywhere already, so they are the one place to apply the plan.
