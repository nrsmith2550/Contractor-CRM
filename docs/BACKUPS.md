# Backups and recovery

Clinch CRM keeps every customer's data in one Postgres database (Neon), so protecting that database
protects everyone. There are four layers, all free to run today. Each covers a different kind of
bad day.

| Layer                   | What it is                                                                             | Covers                                                               | How far back                          | Data you could lose |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- | ------------------- |
| 1. Neon history         | Neon records every change; you can open a copy of the database as it was at any moment | "We deleted something an hour ago", a bad release, a mistaken import | **6 hours** (the free plan's maximum) | seconds             |
| 2. Nightly backup       | A full, encrypted copy made at ~2 am US Eastern, kept as a GitHub artifact             | Anything older than 6 hours, losing the Neon project or account      | **30 days**                           | up to 24 hours      |
| 3. Per-customer restore | `pnpm tenant:data` copies ONE business out of a backup and back in                     | One customer needs their data back without touching the others       | whatever the source covers            | n/a                 |
| 4. Customer exports     | Every list has Export to Excel / CSV                                                   | A customer wants their own copy                                      | any time                              | n/a                 |

Every layer is tested. Section 5 records what was drilled and what has not been.

## 1. One-time setup for the nightly backup (about 5 minutes)

The nightly job reuses the two Neon secrets the test pipeline already has (`NEON_PROJECT_ID`,
`NEON_API_KEY`). It needs **one more secret, an encryption passphrase**:

1. Make up a long random passphrase (six or more random words; a password manager can generate one).
   Save it in your password manager **and a second safe place**. If it is lost the backups cannot be
   opened, and nobody can recover it for you.
2. On GitHub open the repository, then **Settings > Secrets and variables > Actions > New repository
   secret**. Name it `BACKUP_PASSPHRASE` and paste the passphrase.
3. Optional **variables** on the same page (the defaults are right for today):
   - `BACKUP_NEON_BRANCH`: the Neon branch holding the live data. Default `staging`. Change it to
     `main` if production moves to the `main` branch.
   - `BACKUP_DB_ROLE` (default `neondb_owner`) and `BACKUP_DB_NAME` (default `neondb`).
4. Open the **Actions** tab, choose **Nightly backup**, and click **Run workflow**. A good run is green
   and its summary says "Backup verified" with the table and row counts. The backup appears under
   **Artifacts** as `clinch-backup-YYYY-MM-DD`.

Until step 2 is done the job runs, shows a yellow "Backups are not set up yet" notice, and does
nothing. It does not fail red.

**What the job does:** makes a frozen copy of the live database (a temporary Neon branch), dumps it,
restores the dump into a scratch database and compares **every table's row count** with the source,
then encrypts (AES-256) and checks the encrypted file decrypts to exactly the verified dump. Only then
is it uploaded. A green run therefore means the backup has been proven restorable, not just written.
The temporary branch is deleted afterwards.

> The nightly job's logic is tested locally against a real database, but it has not yet run on GitHub
> with your secrets (they can't be set from here). Run it once by hand after step 4 and check it goes
> green. If it doesn't, the first run's log says why; send it to me.

## 2. Recovery runbooks

Pick the one that matches the problem. In all of them, **stop and look before you change anything
live**: restore to a side copy first, check it, then decide.

### A. Something was deleted or broken in the last 6 hours

1. Neon console > the `crm` project > **Branches** > **Create branch**. Choose **Past data** and the
   time just before the mistake. Name it, for example, `recovery-2026-11-13`.
2. Open the new branch (Tables or SQL editor) and confirm the missing data is there.
3. Then either:
   - **One customer affected:** follow runbook C, using this branch as the source.
   - **Everything affected:** point the app at the branch. In Vercel, change `DATABASE_URL` and
     `DATABASE_URL_OWNER` to the branch's connection strings and redeploy. (Anything written since the
     mistake is not in the branch. Prefer C when only one customer is hurt.)
4. When finished, delete the recovery branch.

### B. Something was lost more than 6 hours ago (restore from a nightly backup)

1. GitHub > **Actions** > **Nightly backup** > pick the run from the right day > download the
   `clinch-backup-YYYY-MM-DD` artifact and unzip it.
2. Decrypt (it asks for the passphrase):
   ```bash
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in clinch-backup-2026-11-13.dump.enc -out backup.dump
   ```
3. Create an empty Neon branch (or database) for the recovery and restore into it, using PostgreSQL
   tools version 18 or newer (the database is Postgres 18):
   ```bash
   pg_restore --no-owner --no-privileges --dbname "<connection string of the empty recovery database>" backup.dump
   DATABASE_URL_OWNER="<same connection string>" pnpm db:migrate   # re-applies the app's permissions and row-level security
   ```
   (If this reports "deadlock detected", just run it again; the database was busy tidying the freshly
   restored tables.)
4. Check it, then use it as the source for runbook C (one customer) or as the new live database
   (runbook D, step 3).
5. Delete the decrypted `backup.dump` and the recovery database when done: they hold customer data.

### C. One customer needs their data restored (the others must not be touched)

Needs a source database that has the customer's data from before the problem (a runbook A branch or a
runbook B restore). Use the **owner** connection strings.

```bash
# 1. Find the customer's id in the SOURCE (the recovered copy)
DATABASE_URL_OWNER="<source>" pnpm tenant:data list
# 2. Export just that customer
DATABASE_URL_OWNER="<source>" pnpm tenant:data export --tenant <id> --out customer.json
# 3. Preview the restore into the LIVE database (shows the target and does nothing yet)
DATABASE_URL_OWNER="<live>" pnpm tenant:data import --file customer.json --replace
# 4. Do it. One transaction, checked against the file's row counts before it commits.
DATABASE_URL_OWNER="<live>" pnpm tenant:data import --file customer.json --replace --yes
```

- It replaces only that customer's rows. Every other customer is untouched (this is tested).
- It is **all or nothing**: if anything is wrong, nothing changes.
- It can also bring back a customer who was deleted entirely (leave out `--replace`).
- Sign-in sessions and one-time links are not backed up, so that customer's people sign in again
  (passwords are restored). The restore is recorded in the customer's audit log.
- Delete `customer.json` afterwards: it holds customer data and password hashes.
- Tell the customer what time the data was restored to; anything they entered after that is gone.

### D. The whole database or Neon account is gone

1. Create a new Neon project (free) with a database and an owner role. Create the app role with a new
   password (the same name as before, `crm_app`).
2. Restore the latest nightly backup into it (runbook B, steps 1 to 3). `pnpm db:migrate` re-applies the
   app role's permissions and the row-level security that keeps customers apart.
3. In Vercel set `DATABASE_URL` (app role) and `DATABASE_URL_OWNER` (owner role) to the new database,
   redeploy, and check you can sign in.
4. Check isolation (this was drilled): connected as the app role with no business selected, a query on
   `account` must return 0 rows.

### E. Quick checks

- **Is last night's backup there?** Actions > Nightly backup: green and a recent artifact.
- **See what is in the database:** the Neon console (Tables or SQL editor), using the owner role.

## 3. What each recovery costs you

| Situation                        | Data lost                     | Time to recover (rough) |
| -------------------------------- | ----------------------------- | ----------------------- |
| Mistake in the last 6 hours      | none to a few minutes         | 15 to 30 minutes        |
| One customer, older than 6 hours | up to a day for that customer | about 1 hour            |
| Everything, older than 6 hours   | up to a day                   | 1 to 2 hours            |
| Neon account lost                | up to a day                   | 1 to 2 hours            |

To lose less: a paid Neon plan keeps history for up to 30 days, and the nightly job can be run more
often (edit the cron line in `.github/workflows/backup.yml`).

## 4. Limits found, and what to do about them

- **Neon history is 6 hours on the free plan.** Beyond that you depend on the nightly backup.
- **Neon snapshots cannot protect the live data.** They are only allowed on a project's root branch
  (`main`), and today the live data is on the child branch `staging`. The nightly dump does not rely
  on snapshots, so this does not weaken the plan.
- **The nightly backup lives in GitHub**, so it does not survive losing your GitHub account. Once a
  month, download the newest artifact (encrypted) and keep a copy somewhere else. A free off-GitHub
  home such as Cloudflare R2 can be added later, when that account exists.
- **GitHub keeps artifacts 30 days**, and free private repositories have a storage allowance. Backups
  are small now; check the Actions storage usage as customers grow.
- **The passphrase is a single point of failure** (see setup, step 1). Store it twice.
- **A backup is a copy of customer data.** Treat downloaded and decrypted files like the database:
  keep them private, and delete them when finished.

## 5. Drill record

A backup only counts once it has been restored. Re-run these drills every quarter and after any
change to the database layout, and add a dated entry here.

**2026-11-13 (first drill)**

| Check                                                                                                                                                           | Result                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Open a copy of the live Neon branch and compare it with the original                                                                                            | Same 45 tables, 709 rows, 3 businesses, identical fingerprint                                                                   |
| Nightly pipeline against a real database: dump, restore into a scratch database, compare every table                                                            | 45 tables and 176,195 rows restored and matched exactly                                                                         |
| Encryption: encrypt, decrypt, compare; wrong passphrase                                                                                                         | Identical after the round trip; wrong passphrase rejected; no readable text in the encrypted file                               |
| Safety guards: scratch database the same as the source; scratch database already holding data                                                                   | Both refused; source untouched                                                                                                  |
| Total loss: rebuild a new database from the dump alone, re-apply permissions and security                                                                       | App role saw 0 rows with no business selected, and exactly the business's 205 accounts when pinned to it (matches the original) |
| One customer: wipe a business and restore it; damage a business and restore it; other businesses unchanged; bad file rolls back; people can sign in again after | 7 automated tests pass                                                                                                          |

**Not yet drilled:** opening a Neon branch at a specific past time (the console does this; the tool used
for the drill can only copy the present), and the GitHub job itself running with your secrets (set up
step 4).
