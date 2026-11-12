import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Returns a Drizzle client bound to the restricted app role (DATABASE_URL),
 * or null when it is not configured. Tenant tables must only be queried through
 * withTenant() (added in Phase 1).
 */
export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return drizzle(neon(url), { schema });
}
