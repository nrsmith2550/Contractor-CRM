import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { clientIpFrom } from "@/server/auth/http";
import { getAdminSession, type AdminSessionCheck } from "./auth";
import { isIpAllowed, parseAllowlist } from "./ip";

// A different cookie from the tenant session, scoped to /admin and SameSite=Strict, so a tenant
// session can never act as an admin one and a cross-site request never carries admin cookies.
export const ADMIN_COOKIE = "crm_admin";
const COOKIE_MAX_AGE_SECONDS = 8 * 60 * 60;

export async function setAdminCookie(token: string): Promise<void> {
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearAdminCookie(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
}

export const getAdminToken = async (): Promise<string | undefined> =>
  (await cookies()).get(ADMIN_COOKIE)?.value;

export async function adminRequestContext(): Promise<{ ip: string }> {
  return { ip: clientIpFrom(await headers()) };
}

/**
 * Optional IP allowlist. A blocked caller gets a plain 404, so the console isn't even
 * confirmed to exist. Call this first in every admin page, layout and action.
 */
export async function assertAdminAccess(): Promise<{ ip: string }> {
  const ctx = await adminRequestContext();
  if (!isIpAllowed(ctx.ip, parseAllowlist(process.env.ADMIN_IP_ALLOWLIST))) notFound();
  return ctx;
}

export async function getCurrentAdmin(): Promise<AdminSessionCheck> {
  return getAdminSession(await getAdminToken());
}

/** For console pages and actions: allowlist, then a session that completed the second factor. */
export async function requireAdmin() {
  const { ip } = await assertAdminAccess();
  const session = await getCurrentAdmin();
  if (!session.ok) redirect(session.reason === "pending" ? "/admin/verify" : "/admin/login");
  return { ...session, ip };
}
