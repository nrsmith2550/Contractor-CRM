# Go-live checklist

Hosting decision: **Vercel Pro**. Running costs are estimated at the bottom of this file.

What has to happen before Gantry CRM goes live to paying customers, and who does it. Tick items off
as they are done. Items marked **(live)** cannot be checked from the development environment and
need someone to look at the real site.

## Claude's action items

- [ ] Merge the Gantry CRM rebrand (PR #43) once its checks are green.
- [ ] Production deploy setup: once Vercel Pro is on, wire up the production environment
      variables, migrations and domain.
- [ ] Payments, when you are ready: a Stripe subscription flow (setup fee plus monthly), built and
      tried in a **separate test-mode Stripe account**. Nothing is set up for payments yet, on purpose.
- [ ] Optional before launch: import templates for customers, people and products (today only
      prospects can be imported), a mobile bottom bar, and Terms and Privacy pages once the text exists.
- [ ] Housekeeping: rename the GitHub repository and the hosting project to match the new name.

## Must do before going live

1. [ ] **Upgrade to Vercel Pro** (decided: everything already lives on Vercel). The free Hobby tier
       is for non-commercial use only, and selling licences is commercial. Pro is $20 a month
       with one deploying seat and $20 of usage included. Only you can do this: it involves payment.
2. [ ] **Create a production database.** The deployed site currently uses the shared staging
       database, which also holds the demo data.
3. [ ] **Set the production settings in the host:** the database addresses (app role and owner
       role), the secrets, the app's public web address, and `SUPPORT_EMAIL`. Without
       `SUPPORT_EMAIL` the "Get in touch" and "Get <plan>" buttons on the home page do not work and
       the Help guide has no support address. See `.env.example` for the full list.
4. [ ] **Set up email sending** (a Resend key and a verified domain). Invitations, password
       resets, quote emails and licence-key emails all depend on it; production refuses to run
       without a mail provider rather than lose a licence key.
5. [ ] **Buy and connect the domain name.**
6. [ ] **Create the platform admin account** for `/admin` on production, with its sign-in code
       (TOTP), and set `ADMIN_IP_ALLOWLIST`.
7. [ ] **Add the `BACKUP_PASSPHRASE` secret in GitHub** and run the "Nightly backup" workflow
       once. See `docs/BACKUPS.md`.

## Check on the live site (live)

8. [ ] Two database changes have already run on the shared staging database: the record
       renumbering (PROS-, CUST-, PERS-, DEAL-, REQ-, JOB-) and the new plan column on licences.
       Check the site works after them.
9. [ ] The demo login works (if the demo business is kept).
10. [ ] Download one real quote PDF.
11. [ ] Send one quote email to yourself.
12. [ ] Try restoring from a backup at least once (`docs/BACKUPS.md`).
13. [ ] Open the site on a real phone, including the technician's **My visits** screen.
14. [ ] Check each plan on a test business: Gantry Deals, Gantry Jobs and Gantry Complete should
        each show only their own half of the menu and refuse the other half's addresses.

## Decide

15. [ ] **How you will bill.** There is no checkout. A customer gets in touch, you create a licence
        key in the admin console and send it. Decide how you invoice and collect, how you handle a
        customer who stops paying (suspend their licence, which signs the whole business out on its
        next request), and when to move to automatic subscription billing.
16. [ ] **What the setup fee covers**, and your cancellation and refund terms. The marketing page
        deliberately says nothing about these.
17. [ ] **The price for more than 10 users.** Every plan includes 10; the limit is stored per
        licence and can be raised for any customer in the admin console.
18. [ ] **Whether to keep the demo business** on production.
19. [ ] **Who answers `SUPPORT_EMAIL`**, and how quickly.

## Legal and brand

20. [ ] Write the Terms of Service and Privacy Policy.
21. [ ] Search for the name **Gantry CRM** and the domain before committing to them. "Gantry" is a
        common word, so check it is free to use for software.
22. [ ] Confirm you own the rights to the logo artwork.

## Good to know

- **Prices and plans** live in one file, `src/lib/plans.ts`: Gantry Complete $500 setup + $70 a
  month; Gantry Deals and Gantry Jobs $300 setup + $45 a month each; 10 users included. The
  marketing page reads them from there. See `docs/decisions/0008-plans-and-monthly-pricing.md`.
- **Licence keys** still start with `CRM-`, so every key already issued keeps working.
- **Two browser tests** failed once each in local runs (a password-reset one and a schedule-board
  keyboard one) and passed on retry. Nothing failed on a re-run.
- **Visit page accessibility:** a visit page was added to the demo-business accessibility scan, but
  it has not been confirmed that the scan actually reaches one.
- **Role names** "Sales Manager" and "Customer Service Rep" are unchanged: they are job titles.
- **No monitoring** (error tracking or uptime checks) is set up yet.

## Monthly running costs (estimate)

What you pay each month to keep it running. Prices were checked in November 2026 from each
provider's published pages (links at the end); check them again before you commit. Card-processing
fees will come with payments, and are not included here.

| Cost                     | About 25 customers   | About 100 customers  | About 500 customers   |
| ------------------------ | -------------------- | -------------------- | --------------------- |
| **Vercel Pro** (hosting) | $20                  | $20                  | $20 to $35            |
| **Neon** (database)      | $5 to $15            | $10 to $25           | $25 to $75            |
| **Resend** (email)       | $0 to $20            | $20                  | $20 to $65            |
| **Domain name**          | about $1             | about $1             | about $1              |
| **Total**                | **about $25 to $55** | **about $50 to $65** | **about $65 to $175** |

Against revenue: every customer pays at least $45 a month, so 100 customers is at least $4,500 a
month and the running costs above are around 1% of that.

### What was measured, and what is assumed

**Measured** on a production build with a seeded demo business (the database was on the same
machine, so real-world waiting time on the database will be higher; hosting only bills for the time
the processor is actually busy):

- A typical page takes about **20 to 40 milliseconds** to produce on the server (home 42, a list
  about 26, a customer record 36, the quote page 31, the pipeline 21, the schedule 28).
- A quote PDF takes about **45 milliseconds** once warm (the first one about 150).
- An Excel export of the prospects list takes about **13 milliseconds**.
- A whole demo business (prospects, customers, deals, quotes, orders, requests, jobs, visits and
  its history) is **341 rows and about 70 KB**.

**Assumed (not measured)**:

- A customer has about 5 active people, each loading about 60 pages on a working day, which is
  about 10,000 requests a month per customer including the background ones.
- A customer stores about 5 to 15 MB of data a year (about 10,000 rows, with indexes).
- A customer sends about 100 to 300 emails a month, mostly quotes. At 25 customers that is already
  above Resend's free 100 a day, so plan on its $20 plan from launch.

### How each price works

- **Vercel Pro:** $20 a month, which includes one deploying seat and $20 of usage. Usage is billed
  on processor time ($0.128 an hour in the main US regions), memory time ($0.0106 per GB-hour) and
  a small per-request charge. At the assumptions above, compute is a few cents per customer per
  month, so usage stays inside the $20 credit for a long while. Extra people who can deploy cost
  $20 each; viewers are free.
- **Neon:** pay as you go, no monthly minimum: $0.106 per compute-hour and $0.35 per GB-month of
  storage. The database sleeps after 5 idle minutes, so you pay for the hours it is awake. Storage
  stays tiny. The free plan (100 compute-hours and about 0.5 to 1 GB) is fine for testing, but
  production should be on the paid plan. The "about 500 customers" figure assumes it is awake
  most of the day, which is the main thing that moves this number.
- **Resend:** free is 3,000 emails a month and 100 a day. Pro is $20 for 50,000 a month with no
  daily limit, then $0.90 per extra 1,000.
- **Domain:** typically $10 to $20 a year; Vercel Pro includes one free first-year domain.

### What would push costs up

1. The database being awake around the clock (customers in many time zones) or on a larger size.
2. Email volume per customer being higher than assumed.
3. A few very heavy customers on a flat price. The 10-user limit on every licence limits this.

Turn on spend alerts in Vercel and Neon, and divide the monthly bill by the number of customers
now and then. That figure tells you whether pricing needs a look.

Sources: Vercel [Pro plan](https://vercel.com/docs/plans/pro-plan) and
[Fluid compute pricing](https://vercel.com/docs/pricing/regional-pricing/pdx1), Neon
[pricing FAQs](https://neon.com/faqs/affordable-managed-postgres-options-startups) and
Resend [pricing](https://resend.com/pricing).
