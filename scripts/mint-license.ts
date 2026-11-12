/**
 * Issues a license key from the command line (demos, resellers, comps). Prints the key ONCE;
 * only its hash is stored. Writes an audit-log row.
 *
 *   DATABASE_URL_OWNER=... pnpm license:mint --tier team [--email buyer@x.com] [--seats 25] [--reason "Demo"]
 */
import { Client } from "pg";
import { TIERS, isTier } from "../src/lib/tiers";
import {
  generateLicenseKey,
  hashLicenseKey,
  licenseKeyLast5,
  normalizeLicenseKey,
} from "../src/server/auth/license-key";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  const tier = arg("tier");
  if (!isTier(tier)) throw new Error("Pass --tier starter|team|business|enterprise");
  const seats = arg("seats") ? Number(arg("seats")) : TIERS[tier].seatLimit;
  if (!Number.isInteger(seats) || seats < 1) throw new Error("--seats must be a positive integer");
  const email = arg("email")?.toLowerCase();

  const key = generateLicenseKey();
  const normalized = normalizeLicenseKey(key)!;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query<{ id: string }>(
      `insert into license (key_hash, key_last5, tier, seat_limit, buyer_email)
       values ($1, $2, $3, $4, $5) returning id`,
      [hashLicenseKey(normalized), licenseKeyLast5(normalized), tier, seats, email ?? null],
    );
    await client.query(
      `insert into admin_audit_log (admin_id, action, target_type, target_id, reason)
       values (null, 'license.mint_cli', 'license', $1, $2)`,
      [rows[0]!.id, arg("reason") ?? "Minted from the command line"],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    await client.end();
  }
  console.log(
    `License minted (${tier}, ${seats} seats). Copy the key now; it can't be shown again:`,
  );
  console.log(`  ${key}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
