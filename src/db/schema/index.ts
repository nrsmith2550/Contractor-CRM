// Tables are added per module. Tenant-scoped tables live in identity.ts (and later modules);
// each must also be listed in TENANT_TABLES (src/db/tenant-tables.ts) so RLS covers it.
export * from "./platform";
export * from "./identity";
export * from "./sales";
export * from "./service";
