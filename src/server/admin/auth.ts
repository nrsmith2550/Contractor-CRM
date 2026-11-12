import { createHash } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { adminSession, platformAdmin } from "@/db/schema";
import { loginSchema } from "@/lib/validation/auth";
import { logAuthEvent } from "@/server/auth/activation";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { hitRateLimit } from "@/server/auth/rate-limit";
import { hashToken, newToken } from "@/server/auth/tokens";
import { writeAdminAudit } from "./audit";
import { decryptSecret } from "./crypto";
import { verifyTotp } from "./totp";

// Two stages: the password makes a short-lived *pending* session, and only a valid one-time code
// turns it into a full session. The two stages are separate so a stolen password alone, or a
// pending cookie alone, never reaches the console.
export const PENDING_TTL_MS = 10 * 60 * 1000;
export const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // absolute, not sliding
const ADMIN_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;

const GENERIC = "Incorrect email or password.";
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("admin-timing-equaliser-not-real"));

export type AdminLoginResult =
  | { ok: true; token: string }
  | { ok: false; code: "invalid_input" | "rate_limited" | "invalid_credentials"; message: string };

export async function adminPasswordLogin(raw: {
  email: unknown;
  password: unknown;
  ip: string;
}): Promise<AdminLoginResult> {
  const parsed = loginSchema.safeParse({ email: raw.email, password: raw.password });
  if (!parsed.success) return { ok: false, code: "invalid_input", message: GENERIC };
  const { email, password } = parsed.data;

  const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
  const byIp = await hitRateLimit(`adminlogin:ip:${raw.ip}`, ADMIN_LIMIT);
  const byEmail = await hitRateLimit(`adminlogin:email:${emailKey}`, ADMIN_LIMIT);
  if (!byIp.allowed || !byEmail.allowed) {
    await logAuthEvent("admin_login_rate_limited", raw.ip);
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again later." };
  }

  const [admin] = await withPlatform((tx) =>
    tx.select().from(platformAdmin).where(eq(platformAdmin.email, email)),
  );
  const passwordOk = await verifyPassword(admin?.passwordHash ?? (await getDummyHash()), password);
  // An admin with no second factor enrolled can never sign in: 2FA is mandatory.
  if (!admin || !passwordOk || !admin.totpSecretEnc) {
    await logAuthEvent("admin_login_failed", raw.ip);
    return { ok: false, code: "invalid_credentials", message: GENERIC };
  }

  const token = newToken();
  await withPlatform(async (tx) => {
    // Housekeeping: drop this admin's expired sessions.
    await tx
      .delete(adminSession)
      .where(and(eq(adminSession.adminId, admin.id), lt(adminSession.expiresAt, new Date())));
    await tx.insert(adminSession).values({
      adminId: admin.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
      ip: raw.ip,
    });
  });
  return { ok: true, token };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; code: "invalid_session" | "rate_limited" | "invalid_code"; message: string };

export async function adminVerifyTotp(raw: {
  token: string | undefined;
  code: unknown;
  ip: string;
}): Promise<VerifyResult> {
  const badSession: VerifyResult = {
    ok: false,
    code: "invalid_session",
    message: "Your sign-in expired. Start again.",
  };
  if (!raw.token) return badSession;
  const [sess] = await withPlatform((tx) =>
    tx
      .select()
      .from(adminSession)
      .where(eq(adminSession.tokenHash, hashToken(raw.token!))),
  );
  if (!sess || sess.totpVerifiedAt || sess.expiresAt.getTime() <= Date.now()) return badSession;

  // Per admin (not just per IP) so a distributed guess is still capped at 5 per 15 minutes.
  const byAdmin = await hitRateLimit(`admintotp:admin:${sess.adminId}`, ADMIN_LIMIT);
  const byIp = await hitRateLimit(`admintotp:ip:${raw.ip}`, ADMIN_LIMIT);
  if (!byAdmin.allowed || !byIp.allowed) {
    await logAuthEvent("admin_totp_rate_limited", raw.ip);
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again later." };
  }

  const [admin] = await withPlatform((tx) =>
    tx.select().from(platformAdmin).where(eq(platformAdmin.id, sess.adminId)),
  );
  const check =
    admin?.totpSecretEnc && typeof raw.code === "string"
      ? verifyTotp({
          secret: decryptSecret(admin.totpSecretEnc),
          code: raw.code,
          lastStep: admin.totpLastStep,
        })
      : ({ ok: false } as const);
  if (!admin || !check.ok) {
    await logAuthEvent("admin_totp_failed", raw.ip);
    return { ok: false, code: "invalid_code", message: "That code isn't right. Try the next one." };
  }

  const done = await withPlatform(async (tx) => {
    // Burn the code atomically: if another request already used this step (or a later one), the
    // update matches nothing and this sign-in fails.
    const burned = await tx
      .update(platformAdmin)
      .set({ totpLastStep: check.step, lastLoginAt: new Date() })
      .where(
        and(
          eq(platformAdmin.id, admin.id),
          or(isNull(platformAdmin.totpLastStep), lt(platformAdmin.totpLastStep, check.step)),
        ),
      )
      .returning({ id: platformAdmin.id });
    if (burned.length === 0) return false;
    await tx
      .update(adminSession)
      .set({ totpVerifiedAt: new Date(), expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS) })
      .where(eq(adminSession.id, sess.id));
    await writeAdminAudit(
      {
        adminId: admin.id,
        action: "admin.login",
        targetType: "admin",
        targetId: admin.id,
        ip: raw.ip,
      },
      tx,
    );
    return true;
  });
  if (!done) {
    await logAuthEvent("admin_totp_replayed", raw.ip);
    return { ok: false, code: "invalid_code", message: "That code isn't right. Try the next one." };
  }
  return { ok: true };
}

export type AdminSessionCheck =
  | { ok: true; admin: { id: string; email: string }; sessionId: string }
  | { ok: false; reason: "missing" | "expired" | "pending" };

/** Every admin request: the cookie must map to a session that completed the second factor. */
export async function getAdminSession(token: string | undefined): Promise<AdminSessionCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const [row] = await withPlatform((tx) =>
    tx
      .select({
        sessionId: adminSession.id,
        expiresAt: adminSession.expiresAt,
        verifiedAt: adminSession.totpVerifiedAt,
        adminId: platformAdmin.id,
        email: platformAdmin.email,
      })
      .from(adminSession)
      .innerJoin(platformAdmin, eq(adminSession.adminId, platformAdmin.id))
      .where(eq(adminSession.tokenHash, hashToken(token))),
  );
  if (!row) return { ok: false, reason: "missing" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  if (!row.verifiedAt) return { ok: false, reason: "pending" };
  return { ok: true, admin: { id: row.adminId, email: row.email }, sessionId: row.sessionId };
}

export async function adminLogout(sessionId: string, adminId: string, ip: string): Promise<void> {
  await withPlatform(async (tx) => {
    await tx.delete(adminSession).where(eq(adminSession.id, sessionId));
    await writeAdminAudit(
      { adminId, action: "admin.logout", targetType: "admin", targetId: adminId, ip },
      tx,
    );
  });
}
