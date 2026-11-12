"use server";

import { redirect } from "next/navigation";
import { changePasswordSchema } from "@/lib/validation/auth";
import { activateLicense } from "@/server/auth/activation";
import { authenticate, changePassword } from "@/server/auth/credentials";
import {
  clearSessionCookie,
  getCurrentUser,
  requestContext,
  requireUser,
  safeNextPath,
  setSessionCookie,
} from "@/server/auth/http";
import { acceptInvitation } from "@/server/auth/invitations";
import { requestPasswordReset, resetPassword } from "@/server/auth/reset";
import { createSession, destroySession } from "@/server/auth/session";
import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/validation/auth";

/** What a form receives back when the action did not redirect. `field` names the input to flag. */
export type ActionError = { ok: false; message: string; field?: string };
export type ActionResult = ActionError | { ok: true };

const asObject = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** First sign-in: license key + business + owner → tenant, owner account, signed in. */
export async function activateAction(values: unknown): Promise<ActionError> {
  const ctx = await requestContext();
  const res = await activateLicense({ ...asObject(values), ip: ctx.ip });
  if (!res.ok) {
    // A key activates once: send them to sign-in with the owner's masked email as a hint.
    if (res.code === "already_active") {
      redirect(`/login?hint=${encodeURIComponent(res.emailHint ?? "")}`);
    }
    const field =
      res.code === "invalid_key"
        ? "licenseKey"
        : res.code === "weak_password"
          ? "password"
          : res.code === "email_taken"
            ? "ownerEmail"
            : undefined;
    return { ok: false, message: res.message, field };
  }
  const { token } = await createSession({
    tenantId: res.tenantId,
    userId: res.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await setSessionCookie(token);
  redirect("/app");
}

export async function loginAction(values: unknown, next?: string): Promise<ActionError> {
  const ctx = await requestContext();
  const v = asObject(values);
  const res = await authenticate({
    email: v.email,
    password: v.password,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  if (!res.ok) return { ok: false, message: res.message };
  await setSessionCookie(res.token);
  redirect(res.mustChangePassword ? "/change-password" : safeNextPath(next));
}

export async function logoutAction(): Promise<void> {
  const current = await getCurrentUser();
  if (current.ok) await destroySession(current.user.tenantId, current.user.sessionId);
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(values: unknown): Promise<ActionError> {
  const user = await requireUser();
  const parsed = changePasswordSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const res = await changePassword({
    tenantId: user.tenantId,
    userId: user.userId,
    sessionId: user.sessionId,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.password,
    confirmPassword: parsed.data.confirmPassword,
  });
  if (!res.ok) {
    return {
      ok: false,
      message: res.message,
      field: res.code === "wrong_password" ? "currentPassword" : "password",
    };
  }
  redirect("/app");
}

/** Always answers the same for known and unknown addresses (see requestPasswordReset). */
export async function forgotPasswordAction(values: unknown): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Enter a valid email.", field: "email" };
  const ctx = await requestContext();
  const res = await requestPasswordReset({ email: parsed.data.email, ip: ctx.ip });
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}

/** Sets a new password from an emailed link, then sends them to sign in. */
export async function resetPasswordAction(token: string, values: unknown): Promise<ActionError> {
  const parsed = resetPasswordSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const ctx = await requestContext();
  const res = await resetPassword({
    token,
    password: parsed.data.password,
    confirmPassword: parsed.data.confirmPassword,
    ip: ctx.ip,
  });
  if (!res.ok) {
    return {
      ok: false,
      message: res.message,
      field: res.code === "weak_password" || res.code === "mismatch" ? "password" : undefined,
    };
  }
  redirect("/login?reset=1");
}

/** Invitee chooses a name and password, joins the business and is signed in. */
export async function acceptInviteAction(token: string, values: unknown): Promise<ActionError> {
  const ctx = await requestContext();
  const res = await acceptInvitation({ token, values, ip: ctx.ip });
  if (!res.ok) {
    return {
      ok: false,
      message: res.message,
      field: res.code === "weak_password" ? "password" : undefined,
    };
  }
  const { token: sessionToken } = await createSession({
    tenantId: res.tenantId,
    userId: res.userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await setSessionCookie(sessionToken);
  redirect("/app");
}
