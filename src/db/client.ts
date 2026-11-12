import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool as PgPool } from "pg";
import { z } from "zod";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const g = globalThis as unknown as { __crmDbs?: Map<string, Db> };

async function createDb(url: string): Promise<Db> {
  if (/\.neon\.tech/.test(url)) {
    // Neon: WebSocket pool, so interactive transactions (SET LOCAL + queries) work.
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    if (typeof WebSocket !== "undefined") {
      neonConfig.webSocketConstructor =
        WebSocket as unknown as typeof neonConfig.webSocketConstructor;
    }
    return drizzle(new Pool({ connectionString: url }) as unknown as PgPool, { schema });
  }
  // Any other Postgres (local dev, Docker): the standard driver.
  const { Pool } = await import("pg");
  return drizzle(new Pool({ connectionString: url, max: 5 }), { schema });
}

async function getDbFor(url: string): Promise<Db> {
  const cache = (g.__crmDbs ??= new Map());
  let db = cache.get(url);
  if (!db) {
    db = await createDb(url);
    cache.set(url, db);
  }
  return db;
}

/** App-role database (restricted role, subject to RLS), or null when not configured. */
export async function tryGetAppDb(): Promise<Db | null> {
  const url = process.env.DATABASE_URL;
  return url ? getDbFor(url) : null;
}

export async function getAppDb(): Promise<Db> {
  const db = await tryGetAppDb();
  if (!db) throw new Error("DATABASE_URL is not set");
  return db;
}

const uuidSchema = z.string().uuid();

/** Pins the transaction to one tenant. Equivalent to `SET LOCAL app.tenant_id = ...`. */
export async function setTenant(tx: Tx, tenantId: string): Promise<void> {
  const id = uuidSchema.parse(tenantId);
  await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
}

/**
 * The ONLY way application code touches tenant tables: opens a transaction, pins it to the
 * tenant, and runs `fn`. Postgres RLS then hides every other tenant's rows.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getAppDb();
  return db.transaction(async (tx) => {
    await setTenant(tx, tenantId);
    return fn(tx);
  });
}

/**
 * Transaction with no tenant pinned: for platform tables (license, tenant, rate_limit,
 * admin_*). Tenant tables return no rows here. Call `setTenant(tx, id)` mid-transaction when
 * a platform operation legitimately creates or reads tenant data (e.g. activation).
 */
export async function withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getAppDb();
  return db.transaction(fn);
}
