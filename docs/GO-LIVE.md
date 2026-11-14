# Go-live checklist

What has to happen before Gantry CRM goes live to paying customers, and who does it. Tick items off
as they are done. Items marked **(live)** cannot be checked from the development environment and
need someone to look at the real site.

## Claude's action items

- [ ] Merge the Gantry CRM rebrand (PR #43) once its checks are green.
- [ ] Production deploy setup: once the host is chosen, wire up the production environment
      variables, migrations and domain.
- [ ] Payments, when you are ready: a Stripe subscription flow (setup fee plus monthly), built and
      tried in a **separate test-mode Stripe account**. Nothing is set up for payments yet, on purpose.
- [ ] Optional before launch: import templates for customers, people and products (today only
      prospects can be imported), a mobile bottom bar, and Terms and Privacy pages once the text exists.
- [ ] Housekeeping: rename the GitHub repository and the hosting project to match the new name.

## Must do before going live

1. [ ] **Choose production hosting** (Vercel or Cloudflare). Check that the plan you pick permits
       commercial use: the free Vercel tier is understood to be for non-commercial projects only.
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
