/**
 * Applies src/db/rls.sql as the owner role. Run after `drizzle-kit migrate`.
 *   DATABASE_URL_OWNER  owner connection string (required)
 *   APP_DB_ROLE         restricted role the app connects as (default: crm_app)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { TENANT_TABLES } from "../src/db/tenant-tables";

async function main() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");

  const role = process.env.APP_DB_ROLE ?? "crm_app";
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Invalid APP_DB_ROLE: ${role}`);

  const tables = `array[${TENANT_TABLES.map((t) => `'${t}'`).join(", ")}]`;
  const sql = readFileSync(path.join(__dirname, "../src/db/rls.sql"), "utf8")
    .replaceAll("{{APP_ROLE}}", `"${role}"`)
    .replaceAll("{{TENANT_TABLES}}", tables);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log(`RLS applied (app role: ${role}, ${TENANT_TABLES.length} tenant tables)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
