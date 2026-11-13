import type { Client } from "pg";
import { TENANT_TABLES } from "@/db/tenant-tables";

// Per-customer export and restore. The whole database is backed up as one (pg_dump, Neon history),
// but restoring ONE business from that after a mistake ("we deleted all our quotes") must not
// disturb the others. So: restore a backup to a side copy, export that business from it, then
// import into the live database, replacing only that business's rows.
//
// Both directions work on the same list of tenant tables the row-level security uses, in an order
// worked out from the database's own foreign keys (parents before children). An import runs in ONE
// transaction and is checked against the file's row counts before it commits, so it either
// restores the business completely or changes nothing.
//
// The file contains customer data and password hashes: treat it like the database itself.

export const EXPORT_FORMAT = 1;

/**
 * Left out of an export: sign-in sessions and one-time tokens. They are short-lived, they are
 * credentials, and restoring a stale one would only be a risk. People sign in again after a restore.
 */
export const EPHEMERAL_TABLES = ["session", "password_reset_token", "invitation"] as const;
const isEphemeral = (t: string) => (EPHEMERAL_TABLES as readonly string[]).includes(t);

type Row = Record<string, unknown>;

export type TenantExport = {
  format: typeof EXPORT_FORMAT;
  exportedAt: string;
  /** How many migrations the source database had applied (to warn about a mismatch on import). */
  migrations: number | null;
  tenant: Row;
  licenses: Row[];
  tables: Record<string, Row[]>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (id: string) => {
  if (!IDENT.test(id)) throw new Error(`Unsafe name in the file: ${id}`);
  return `"${id}"`;
};

/** Read every value as the database's own text (exact timestamps, exact numbers), with JSON parsed. */
const RAW = {
  getTypeParser: (oid: number) => {
    if (oid === 3802 || oid === 114) return (v: string) => JSON.parse(v) as unknown; // jsonb, json
    if (oid === 16) return (v: string) => v === "t"; // boolean
    return (v: string) => v;
  },
};
const query = (c: Client, text: string, values: unknown[] = []) =>
  c.query({ text, values, types: RAW as never });

async function migrationCount(c: Client): Promise<number | null> {
  try {
    const r = await query(c, "select count(*)::int as n from drizzle.__drizzle_migrations");
    return Number(r.rows[0]?.n ?? 0);
  } catch {
    return null;
  }
}

/** Tenant tables in an order that is safe to insert in: every table after the ones it points at. */
export async function insertOrder(c: Client): Promise<string[]> {
  const set = new Set<string>(TENANT_TABLES);
  const r = await query(
    c,
    `select conrelid::regclass::text as child, confrelid::regclass::text as parent
       from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace`,
  );
  const unquote = (s: string) => s.replace(/^"|"$/g, "");
  const parents = new Map<string, Set<string>>(TENANT_TABLES.map((t) => [t, new Set()]));
  for (const row of r.rows as { child: string; parent: string }[]) {
    const child = unquote(row.child);
    const parent = unquote(row.parent);
    if (set.has(child) && set.has(parent) && child !== parent) parents.get(child)!.add(parent);
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < set.size) {
    const ready = [...set].filter(
      (t) => !done.has(t) && [...parents.get(t)!].every((p) => done.has(p)),
    );
    if (ready.length === 0)
      throw new Error("The tables reference each other in a loop; cannot order them.");
    for (const t of ready.sort()) {
      order.push(t);
      done.add(t);
    }
  }
  return order;
}

export async function listTenants(c: Client) {
  const r = await query(
    c,
    `select t.id, t.name, t.created_at,
            (select count(*)::int from "system_user" u where u.tenant_id = t.id) as users
       from tenant t order by t.created_at`,
  );
  return r.rows as { id: string; name: string; created_at: string; users: number }[];
}

export async function exportTenant(c: Client, tenantId: string): Promise<TenantExport> {
  if (!UUID.test(tenantId)) throw new Error("That isn't a valid business id.");
  const t = await query(c, "select * from tenant where id = $1", [tenantId]);
  if (t.rows.length === 0) throw new Error("No business with that id in this database.");
  const licenses = await query(c, "select * from license where tenant_id = $1", [tenantId]);
  const tables: Record<string, Row[]> = {};
  for (const name of TENANT_TABLES) {
    if (isEphemeral(name)) continue;
    const r = await query(c, `select * from ${q(name)} where tenant_id = $1`, [tenantId]);
    tables[name] = r.rows as Row[];
  }
  return {
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    migrations: await migrationCount(c),
    tenant: t.rows[0] as Row,
    licenses: licenses.rows as Row[],
    tables,
  };
}

export function countsOf(data: TenantExport): Record<string, number> {
  return Object.fromEntries(Object.entries(data.tables).map(([t, rows]) => [t, rows.length]));
}

const CHUNK = 500;

/** Inserts rows by letting Postgres convert the JSON to the table's own column types. */
async function insertRows(c: Client, table: string, rows: Row[]) {
  if (rows.length === 0) return;
  const cols = await query(
    c,
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER'`,
    [table],
  );
  const known = new Set((cols.rows as { column_name: string }[]).map((r) => r.column_name));
  // Only columns the file has AND the table still has; columns added since fall back to their defaults.
  const names = Object.keys(rows[0]!).filter((k) => known.has(k));
  const list = names.map(q).join(", ");
  for (let i = 0; i < rows.length; i += CHUNK) {
    await c.query(
      `insert into ${q(table)} (${list})
       select ${list} from jsonb_populate_recordset(null::${q(table)}, $1::jsonb)`,
      [JSON.stringify(rows.slice(i, i + CHUNK))],
    );
  }
}

export type ImportResult = { tenantId: string; replaced: boolean; rows: number };

/**
 * Puts a business's data into this database. With `replace`, an existing business is cleared first
 * (only its own rows) and then restored from the file. Without it, importing over an existing
 * business is refused. One transaction, verified against the file before it commits.
 */
export async function importTenant(
  c: Client,
  data: TenantExport,
  opts: { replace?: boolean } = {},
): Promise<ImportResult> {
  if (data?.format !== EXPORT_FORMAT)
    throw new Error("This isn't a business export this version can read.");
  const id = String(data.tenant?.id ?? "");
  if (!UUID.test(id)) throw new Error("The file has no valid business id.");
  for (const name of Object.keys(data.tables)) {
    if (!(TENANT_TABLES as readonly string[]).includes(name) || isEphemeral(name)) {
      throw new Error(`The file contains a table this tool doesn't restore: ${name}`);
    }
  }

  const order = await insertOrder(c);
  const here = await migrationCount(c);
  if (here !== null && data.migrations !== null && here < data.migrations) {
    throw new Error(
      `The file came from a newer database (${data.migrations} migrations) than this one (${here}). Update this database first.`,
    );
  }

  await c.query("begin");
  try {
    // Pin the transaction to this business, so it also works where row-level security applies.
    await c.query("select set_config('app.tenant_id', $1, true)", [id]);
    const existing = await query(c, "select id from tenant where id = $1 for update", [id]);
    const replaced = existing.rows.length > 0;
    if (replaced && !opts.replace) {
      throw new Error(
        "That business already exists here. Re-run with replace to overwrite its data.",
      );
    }

    if (replaced) {
      // Children before parents, including the short-lived tables the export leaves out.
      for (const name of [...order].reverse())
        await c.query(`delete from ${q(name)} where tenant_id = $1`, [id]);
      await c.query("delete from license where tenant_id = $1", [id]);
      const cols = Object.keys(data.tenant).filter((k) => k !== "id");
      const list = cols.map(q).join(", ");
      await c.query(
        `update tenant set (${list}) = (select ${list} from jsonb_populate_record(null::tenant, $2::jsonb)) where id = $1`,
        [id, JSON.stringify(data.tenant)],
      );
    } else {
      const list = Object.keys(data.tenant).map(q).join(", ");
      await c.query(
        `insert into tenant (${list}) select ${list} from jsonb_populate_record(null::tenant, $1::jsonb)`,
        [JSON.stringify(data.tenant)],
      );
    }
    await insertRows(c, "license", data.licenses);
    for (const name of order) await insertRows(c, name, data.tables[name] ?? []);

    // Verify before committing: every table must hold exactly what the file said.
    let total = 0;
    for (const [name, rows] of Object.entries(data.tables)) {
      const r = await query(c, `select count(*)::int as n from ${q(name)} where tenant_id = $1`, [
        id,
      ]);
      if (Number(r.rows[0]!.n) !== rows.length) {
        throw new Error(
          `Verification failed for ${name}: expected ${rows.length} rows, found ${r.rows[0]!.n}.`,
        );
      }
      total += rows.length;
    }
    await c.query(
      `insert into audit_log (tenant_id, entity, record_id, action, changes)
       values ($1::uuid, 'tenant', $1::text, 'restore', $2::jsonb)`,
      [id, JSON.stringify({ exportedAt: data.exportedAt, rows: total, replaced })],
    );
    await c.query("commit");
    return { tenantId: id, replaced, rows: total };
  } catch (err) {
    await c.query("rollback");
    throw err;
  }
}
