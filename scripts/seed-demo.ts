/**
 * Creates a NEW demo business ("Summit Plumbing & Heating") full of realistic data: staff in each
 * role, customers, a sales pipeline, quotes and orders, support cases, jobs, a crew and a
 * schedule. It goes through the app's own domain code, so the data obeys every rule. Existing
 * businesses are never touched; every run adds one more.
 *
 *   export DATABASE_URL=...          # the app role, the same one the site uses
 *   pnpm db:seed-demo --yes          # --yes confirms the database shown on screen is the right one
 *
 * Optional:  --password "..."   (otherwise a random one is generated and printed once)
 *            --company "Name"   --time-zone America/Chicago
 *
 * Never point this at a database with real customers in it. The demo logins are for show.
 */
import { randomBytes } from "node:crypto";
import { seedDemo } from "../src/db/seed/demo";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const target = new URL(url);
  console.log(`Target database: ${target.hostname}${target.pathname}`);
  if (!process.argv.includes("--yes")) {
    console.log("\nThis adds a demo business to that database. Re-run with --yes to confirm.");
    process.exitCode = 1;
    return;
  }

  const id = randomBytes(3).toString("hex");
  const password = arg("password") ?? randomBytes(12).toString("base64url");
  const result = await seedDemo({
    ownerEmail: `owner@demo-${id}.example`,
    emailDomain: `demo-${id}.example`,
    password,
    companyName: arg("company"),
    timeZone: arg("time-zone"),
    log: (m) => console.log(`  ${m}`),
  });

  console.log(`\nDemo business ready: ${result.companyName}`);
  console.log("Counts:", JSON.stringify(result.counts));
  console.log("\nSign in at /login with any of these (same password for all):\n");
  for (const p of result.people)
    console.log(`  ${p.role.padEnd(22)} ${p.name.padEnd(16)} ${p.email}`);
  console.log(`\n  Password: ${password}`);
  console.log("\nThe password is shown once and is not stored anywhere you can read it back.");
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
