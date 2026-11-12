/**
 * Bootstraps a platform admin (the first one, or another). Prints the authenticator secret ONCE.
 *
 *   export DATABASE_URL_OWNER=...  ADMIN_TOTP_KEY=...     # 32 random bytes, base64
 *   export ADMIN_EMAIL=you@example.com
 *   read -rs ADMIN_PASSWORD && export ADMIN_PASSWORD      # keeps it out of shell history
 *   pnpm admin:create
 *
 * Generate the encryption key once with:  openssl rand -base64 32
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { createPlatformAdmin } from "../src/server/admin/bootstrap";

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  if (!process.env.ADMIN_TOTP_KEY) {
    throw new Error("ADMIN_TOTP_KEY is not set (generate one with: openssl rand -base64 32)");
  }
  if (!email || !password) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (use `read -rs ADMIN_PASSWORD`)");
  }

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool, { schema });
    const admin = await db.transaction((tx) => createPlatformAdmin(tx, { email, password }));
    console.log(`Platform admin created: ${email}`);
    console.log("");
    console.log("Add this to your authenticator app NOW. It is shown only once:");
    console.log(`  Secret key: ${admin.secretBase32}`);
    console.log(`  otpauth URI: ${admin.uri}`);
    console.log("");
    console.log("Sign in at /admin with your password, then the 6-digit code.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
