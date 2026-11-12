/**
 * Every table that carries `tenant_id` and must be fenced by Row-Level Security.
 * rls.sql installs the policy on each of these. An integration test also introspects the
 * database and fails if any table with a `tenant_id` column is missing here.
 */
export const TENANT_TABLES = [
  "system_user",
  "session",
  "password_reset_token",
  "invitation",
  "security_role",
  "user_role",
  "audit_log",
  "sequence",
] as const;
