import { and, eq, sql } from "drizzle-orm";
import { withPlatform, withTenant } from "@/db/client";
import { session } from "@/db/schema";
import { hashToken, newToken } from "./tokens";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30-day sliding window
const REFRESH_AFTER_MS = 10 * 60 * 1000; // extend at most every 10 minutes

export type SessionUser = {
  sessionId: string;
  userId: string;
  tenantId: string;
  email: string;
  fullName: string;
  isOwner: boolean;
  mustChangePassword: boolean;
};

export type SessionCheck =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "missing" | "expired" | "disabled" | "license_inactive" };

/** Creates a session and returns the raw token for the cookie. Only its hash is stored. */
export async function createSession(args: {
  tenantId: string;
  userId: string;
  ip?: string;
  userAgent?: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await withTenant(args.tenantId, (tx) =>
    tx.insert(session).values({
      tenantId: args.tenantId,
      userId: args.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: args.ip,
      userAgent: args.userAgent?.slice(0, 300),
    }),
  );
  return { token, expiresAt };
}

type SessionRow = {
  session_id: string;
  user_id: string;
  tenant_id: string;
  expires_at: Date;
  must_change_password: boolean;
  disabled_at: Date | null;
  is_owner: boolean;
  license_status: string | null;
  email: string;
  full_name: string;
};

/**
 * Every request: session -> user -> tenant -> license must be active. A suspended or revoked
 * license therefore signs the whole tenant out on its next request.
 */
export async function validateSession(token: string | undefined): Promise<SessionCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const res = await withPlatform((tx) =>
    tx.execute<SessionRow>(sql`select * from auth_find_session(${hashToken(token)})`),
  );
  const row = res.rows[0];
  if (!row) return { ok: false, reason: "missing" };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (row.disabled_at) return { ok: false, reason: "disabled" };
  if (row.license_status !== "active") return { ok: false, reason: "license_inactive" };

  if (new Date(row.expires_at).getTime() < Date.now() + SESSION_TTL_MS - REFRESH_AFTER_MS) {
    await withTenant(row.tenant_id, (tx) =>
      tx
        .update(session)
        .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastSeenAt: new Date() })
        .where(eq(session.id, row.session_id)),
    );
  }
  return {
    ok: true,
    user: {
      sessionId: row.session_id,
      userId: row.user_id,
      tenantId: row.tenant_id,
      email: row.email,
      fullName: row.full_name,
      isOwner: row.is_owner,
      mustChangePassword: row.must_change_password,
    },
  };
}

export async function destroySession(tenantId: string, sessionId: string): Promise<void> {
  await withTenant(tenantId, (tx) => tx.delete(session).where(eq(session.id, sessionId)));
}

/** Signs a user out everywhere (used by admin resets and password changes). */
export async function revokeUserSessions(tenantId: string, userId: string): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.delete(session).where(and(eq(session.tenantId, tenantId), eq(session.userId, userId))),
  );
}
