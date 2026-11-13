import { createHash } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { withPlatform, withTenant } from "@/db/client";
import { auditLog, session, systemUser } from "@/db/schema";
import { loginSchema } from "@/lib/validation/auth";
import { logAuthEvent } from "./activation";
import { hashPassword, validatePassword, verifyPassword } from "./password";
import { LOGIN_LIMIT, hitRateLimit } from "./rate-limit";
import { createSession } from "./session";

export type LoginResult =
  | {
      ok: true;
      token: string;
      expiresAt: Date;
      tenantId: string;
      userId: string;
      mustChangePassword: boolean;
    }
  | {
      ok: false;
      code:
        "invalid_input" | "rate_limited" | "invalid_credentials" | "disabled" | "license_inactive";
      message: string;
    };

type UserRow = {
  user_id: string;
  tenant_id: string;
  password_hash: string;
  must_change_password: boolean;
  disabled_at: Date | null;
  is_owner: boolean;
  license_status: string | null;
};

// Verified against when the email is unknown, so "no such user" costs the same time as
// "wrong password" and cannot be told apart by timing.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("timing-equaliser-not-a-real-password"));

const fail = (code: Extract<LoginResult, { ok: false }>["code"], message: string): LoginResult => ({
  ok: false,
  code,
  message,
});

const GENERIC = "Incorrect email or password.";

/**
 * Email + password → session. Every attempt counts against the IP and against the email
 * (hashed, so no address is stored in the counter table). Failures are logged without the
 * email or password. Account state (disabled, license inactive) is only revealed after the
 * password was correct, so it can't be used to probe which emails exist.
 */
export async function authenticate(raw: {
  email: unknown;
  password: unknown;
  ip: string;
  userAgent?: string;
}): Promise<LoginResult> {
  const parsed = loginSchema.safeParse({ email: raw.email, password: raw.password });
  if (!parsed.success) return fail("invalid_input", GENERIC);
  const { email, password } = parsed.data;

  const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
  const byIp = await hitRateLimit(`login:ip:${raw.ip}`, LOGIN_LIMIT);
  const byEmail = await hitRateLimit(`login:email:${emailKey}`, LOGIN_LIMIT);
  if (!byIp.allowed || !byEmail.allowed) {
    await logAuthEvent("login_rate_limited", raw.ip);
    return fail("rate_limited", "Too many attempts. Try again in 15 minutes.");
  }

  const res = await withPlatform((tx) =>
    tx.execute<UserRow>(sql`select * from auth_find_user_by_email(${email})`),
  );
  const user = res.rows[0];
  const passwordOk = await verifyPassword(user?.password_hash ?? (await getDummyHash()), password);
  if (!user || !passwordOk) {
    await logAuthEvent("login_failed", raw.ip);
    return fail("invalid_credentials", GENERIC);
  }
  if (user.disabled_at) {
    await logAuthEvent("login_disabled", raw.ip);
    return fail("disabled", "Your access has been turned off. Contact your administrator.");
  }
  if (user.license_status !== "active") {
    await logAuthEvent("login_license_inactive", raw.ip);
    return fail("license_inactive", "This license isn't active. Contact support.");
  }

  const { token, expiresAt } = await createSession({
    tenantId: user.tenant_id,
    userId: user.user_id,
    ip: raw.ip,
    userAgent: raw.userAgent,
  });
  return {
    ok: true,
    token,
    expiresAt,
    tenantId: user.tenant_id,
    userId: user.user_id,
    mustChangePassword: user.must_change_password,
  };
}

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      code: "rate_limited" | "wrong_password" | "weak_password" | "mismatch";
      message: string;
    };

/**
 * Signed-in password change (also the forced change after an admin temporary password).
 * Requires the current password, applies the same policy as activation, clears
 * `must_change_password`, and signs every other session out.
 */
export async function changePassword(args: {
  tenantId: string;
  userId: string;
  sessionId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<ChangePasswordResult> {
  // Throttle guesses of the current password from a stolen session.
  const limited = await hitRateLimit(`pwchange:user:${args.userId}`, LOGIN_LIMIT);
  if (!limited.allowed) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again later." };
  }
  if (args.newPassword !== args.confirmPassword) {
    return { ok: false, code: "mismatch", message: "Passwords do not match" };
  }

  const [user] = await withTenant(args.tenantId, (tx) =>
    tx.select().from(systemUser).where(eq(systemUser.id, args.userId)),
  );
  if (!user || !(await verifyPassword(user.passwordHash, args.currentPassword))) {
    return { ok: false, code: "wrong_password", message: "Your current password is incorrect." };
  }
  const policy = validatePassword(args.newPassword, [
    user.email.split("@")[0] ?? "",
    user.fullName,
  ]);
  if (!policy.ok) return { ok: false, code: "weak_password", message: policy.reason };
  if (await verifyPassword(user.passwordHash, args.newPassword)) {
    return {
      ok: false,
      code: "weak_password",
      message: "Choose a password you haven't used here before.",
    };
  }

  const passwordHash = await hashPassword(args.newPassword);
  await withTenant(args.tenantId, async (tx) => {
    await tx
      .update(systemUser)
      .set({ passwordHash, mustChangePassword: false, modifiedAt: new Date() })
      .where(eq(systemUser.id, args.userId));
    await tx
      .delete(session)
      .where(and(eq(session.userId, args.userId), ne(session.id, args.sessionId)));
    await tx.insert(auditLog).values({
      tenantId: args.tenantId,
      entity: "system_user",
      recordId: args.userId,
      action: "change_password",
      userId: args.userId,
    });
  });
  return { ok: true };
}
