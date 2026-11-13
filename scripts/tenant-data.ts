/**
 * Export or restore ONE business, without touching the others. Used to recover a single customer
 * from a backup (see docs/BACKUPS.md). Run it with the database OWNER connection.
 *
 *   export DATABASE_URL_OWNER=...                         # the database you are reading from or writing to
 *   pnpm tenant:data list
 *   pnpm tenant:data export --tenant <id> --out acme.json
 *   pnpm tenant:data import --file acme.json --replace --yes
 *
 * The file holds customer data and password hashes. Keep it as private as the database, and delete
 * it when finished. `import` shows the target database and does nothing without --yes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import {
  countsOf,
  exportTenant,
  importTenant,
  listTenants,
  type TenantExport,
} from "../src/server/backup/tenant-data";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  const command = process.argv[2];
  const target = new URL(url);
  const where = `${target.hostname}${target.pathname}`;

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (command === "list") {
      console.log(`Database: ${where}\n`);
      for (const t of await listTenants(client)) {
        console.log(`${t.id}  ${t.name}  (${t.users} users, created ${t.created_at})`);
      }
    } else if (command === "export") {
      const id = arg("tenant");
      const out = arg("out");
      if (!id || !out) throw new Error("Usage: export --tenant <id> --out <file.json>");
      const data = await exportTenant(client, id);
      writeFileSync(out, JSON.stringify(data), { mode: 0o600 });
      const counts = countsOf(data);
      const rows = Object.values(counts).reduce((a, n) => a + n, 0);
      console.log(
        `Exported "${String(data.tenant.name)}" from ${where}: ${rows} rows in ${Object.keys(counts).length} tables -> ${out}`,
      );
      console.log(
        "This file holds customer data and password hashes. Keep it private and delete it when done.",
      );
    } else if (command === "import") {
      const file = arg("file");
      if (!file) throw new Error("Usage: import --file <file.json> [--replace] --yes");
      const data = JSON.parse(readFileSync(file, "utf8")) as TenantExport;
      const rows = Object.values(countsOf(data)).reduce((a, n) => a + n, 0);
      console.log(`Target database: ${where}`);
      console.log(
        `Business: "${String(data.tenant.name)}" (${String(data.tenant.id)}), ${rows} rows, exported ${data.exportedAt}`,
      );
      console.log(
        flag("replace")
          ? "Mode: REPLACE this business's current data with the file."
          : "Mode: add (refuses if the business already exists).",
      );
      if (!flag("yes")) {
        console.log("\nRe-run with --yes to go ahead.");
        process.exitCode = 1;
        return;
      }
      const r = await importTenant(client, data, { replace: flag("replace") });
      console.log(
        `Restored ${r.rows} rows${r.replaced ? " (replaced the existing data)" : ""}. Verified against the file before committing.`,
      );
      console.log("People will need to sign in again: sessions are not part of a backup.");
    } else {
      throw new Error("Commands: list | export | import");
    }
  } finally {
    await client.end();
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
