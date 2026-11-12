import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withPlatform, withTenant } from "@/db/client";
import { auditLog, passwordResetToken, session, systemUser } from "@/db/schema";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { sendEmail } from "@/server/email/mailer";
import { passwordResetEmail } from "@/server/email/templates";
import { logAuthEvent } from "./activation";
import { hashPassword, validatePassword } from "./password";
import { hitRateLimit } from "./rate-limit";
import { hashToken, newToken } from "./tokens";

export const RESET_TTL_MS = 30 * 60 * 1000; // single-use, 30 minutes
const FORGOT_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;
const RESET_LIMIT = { max: 10, windowSeconds: 15 * 60 } as const;

type Deps = { send?: typeof sendEmail; appUrl?: string };

type UserRow = {
  user_id: string;
  tenant_id: string;
  disabled_at: Date | null;
  license_status: string | null;
};
type TokenRow = {
  token_id: string;
  tenant_id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  email: string;
};

export type ForgotResult =
  { ok: true } | { ok: false; code: "invalid_input" | "rate_limited"; message: string };

/**
 * "Forgot password". The answer is always the same for a known and an unknown address, so it
 * can't be used to find out who has an account. A link is only created (and emailed) for an
 * enabled user on an active license; any earlier unused link for that user is invalidated.
 */
export async function requestPasswordReset(
  raw: { email: unknown; ip: string },
  deps: Deps = {},
): Promise<ForgotResult> {
  const parsed = forgotPasswordSchema.safeParse({ email: raw.email });
  if (!parsed.success) {
    return { ok: false, code: "invalid_input", message: "Enter a valid email." };
  }
  const { email } = parsed.data;

  const emailKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
  const byIp = await hitRateLimit(`forgot:ip:${raw.ip}`, FORGOT_LIMIT);
  const byEmail = await hitRateLimit(`forgot:email:${emailKey}`, FORGOT_LIMIT);
  if (!byIp.allowed || !byEmail.allowed) {
    await logAuthEvent("forgot_rate_limited", raw.ip);
    return { ok: false, code: "rate_limited", message: "Too many requests. Try again later." };
  }

  const res = await withPlatform((tx) =>
    tx.execute<UserRow>(sql`select * from auth_find_user_by_email(${email})`),
  );
  const user = res.rows[0];
  if (user && !user.disabled_at && user.license_status === "active") {
    const token = newToken();
    await withTenant(user.tenant_id, async (tx) => {
      await tx
        .update(passwordResetToken)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetToken.userId, user.user_id), isNull(passwordResetToken.usedAt)));
      await tx.insert(passwordResetToken).values({
        tenantId: user.tenant_id,
        userId: user.user_id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
        issuedBy: "self",
      });
    });
    try {
      const appUrl = deps.appUrl ?? process.env.APP_URL ?? "";
      await (deps.send ?? sendEmail)(passwordResetEmail({ to: email, token, appUrl }));
    } catch (err) {
      // Don't tell the caller (that would reveal the account exists); do tell the logs.
      console.error("password reset email failed:", err instanceof Error ? err.message : err);
    }
  }
  return { ok: true };
}

async function findToken(token: string): Promise<TokenRow | undefined> {
  const res = await withPlatform((tx) =>
    tx.execute<TokenRow>(sql`select * from auth_find_reset_token(${hashToken(token)})`),
  );
  return res.rows[0];
}

const usable = (row: TokenRow | undefined): row is TokenRow =>
  !!row && !row.used_at && new Date(row.expires_at).getTime() > Date.now();

/** Lets the reset page show "link expired" instead of a form that can never succeed. */
export async function isResetTokenUsable(token: string | undefined): Promise<boolean> {
  return token ? usable(await findToken(token)) : false;
}

export type ResetResult =
  | { ok: true }
  | {
      ok: false;
      code: "rate_limited" | "invalid_token" | "weak_password" | "mismatch";
      message: string;
    };

/**
 * Sets a new password from an emailed link. A weak password is rejected *before* the link is
 * spent, so the user can retry. On success the link is consumed atomically (a second use, or
 * two racing uses, fails), every session for the user is signed out, and any other unused links
 * are invalidated.
 */
export async function resetPassword(args: {
  token: string;
  password: string;
  confirmPassword: string;
  ip: string;
}): Promise<ResetResult> {
  const limited = await hitRateLimit(`reset:ip:${args.ip}`, RESET_LIMIT);
  if (!limited.allowed) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again later." };
  }
  const invalid: ResetResult = {
    ok: false,
    code: "invalid_token",
    message: "This link has expired or was already used. Request a new one.",
  };
  if (args.password !== args.confirmPassword) {
    return { ok: false, code: "mismatch", message: "Passwords do not match" };
  }
  const row = await findToken(args.token);
  if (!usable(row)) return invalid;

  const policy = validatePassword(args.password, [row.email.split("@")[0] ?? ""]);
  if (!policy.ok) return { ok: false, code: "weak_password", message: policy.reason };

  const passwordHash = await hashPassword(args.password);
  const done = await withTenant(row.tenant_id, async (tx) => {
    const claimed = await tx
      .update(passwordResetToken)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetToken.id, row.token_id),
          isNull(passwordResetToken.usedAt),
          sql`${passwordResetToken.expiresAt} > now()`,
        ),
      )
      .returning({ id: passwordResetToken.id });
    if (claimed.length === 0) return false; // lost a race / already used

    await tx
      .update(systemUser)
      .set({ passwordHash, mustChangePassword: false, modifiedAt: new Date() })
      .where(eq(systemUser.id, row.user_id));
    await tx
      .update(passwordResetToken)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetToken.userId, row.user_id), isNull(passwordResetToken.usedAt)));
    await tx.delete(session).where(eq(session.userId, row.user_id));
    await tx.insert(auditLog).values({
      tenantId: row.tenant_id,
      entity: "system_user",
      recordId: row.user_id,
      action: "reset_password",
      userId: row.user_id,
    });
    return true;
  });
  return done ? { ok: true } : invalid;
}
