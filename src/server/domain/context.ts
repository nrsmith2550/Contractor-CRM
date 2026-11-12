import { eq, type AnyColumn, type SQL } from "drizzle-orm";
import { can, type Action, type Entity, type Subject } from "@/server/security/roles";
import { loadSubject } from "@/server/security/subject";

/** Who is acting. Built once per request from the validated session. */
export type Ctx = { tenantId: string; userId: string; subject: Subject };

export async function buildCtx(tenantId: string, userId: string): Promise<Ctx> {
  return { tenantId, userId, subject: await loadSubject(tenantId, userId) };
}

export type ErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid"
  | "read_only"
  | "missing_fields"
  | "duplicates"
  | "conflict"
  | "rate_limited"
  | "unavailable";

export type Fail = { ok: false; code: ErrorCode; message: string } & Record<string, unknown>;
export type Result<T extends object = object> = ({ ok: true } & T) | Fail;

export const fail = (
  code: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Fail => ({
  ok: false,
  code,
  message,
  ...extra,
});

export const NOT_FOUND = fail(
  "not_found",
  "That record doesn't exist or you don't have access to it.",
);
export const FORBIDDEN = fail("forbidden", "You don't have permission to do that.");

/**
 * Visibility + permission for one existing record. A record the user may not even read is
 * reported as "not found" (so its existence isn't revealed); one they may read but not change
 * is "forbidden". `can()` applies the user/organization depth against the record's owner.
 */
export function checkRecord(
  ctx: Ctx,
  entity: Entity,
  action: Action,
  record: { ownerId: string } | null | undefined,
): Fail | null {
  if (!record || !can(ctx.subject, entity, "read", record)) return NOT_FOUND;
  if (action !== "read" && !can(ctx.subject, entity, action, record)) return FORBIDDEN;
  return null;
}

/**
 * For list queries: the SQL condition that limits rows to what the user may read, or `null` when
 * they may not read the entity at all. Organization depth adds no condition; user depth
 * restricts to records they own.
 */
export function readScope(
  subject: Subject,
  entity: Entity,
  ownerColumn: AnyColumn,
): { allowed: false } | { allowed: true; where: SQL | undefined } {
  const depth = subject.privileges[entity]?.read;
  if (!depth) return { allowed: false };
  return {
    allowed: true,
    where: depth === "organization" ? undefined : eq(ownerColumn, subject.userId),
  };
}
