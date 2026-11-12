import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, type SessionCheck, type SessionUser } from "./session";

export const SESSION_COOKIE = "crm_session";

/**
 * The cookie only carries the random token. The database is the authority on validity (and
 * extends the 30-day sliding expiry), so the cookie itself is long-lived rather than slid:
 * a server component cannot refresh a cookie.
 */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Every request: cookie → session → user → tenant → license must be active. */
export async function getCurrentUser(): Promise<SessionCheck> {
  return validateSession(await getSessionToken());
}

/** For pages and server actions that need a signed-in user; otherwise sends them to /login. */
export async function requireUser(): Promise<SessionUser> {
  const result = await getCurrentUser();
  if (!result.ok) {
    redirect(result.reason === "license_inactive" ? "/login?reason=license" : "/login");
  }
  return result.user;
}

/**
 * Client IP for rate limiting. Behind Cloudflare, CF-Connecting-IP is set by the edge and
 * cannot be spoofed by the caller. Otherwise prefer X-Real-IP, then the RIGHTMOST
 * X-Forwarded-For entry (the one our own proxy appended), never the leftmost, which the client
 * controls.
 */
export function clientIpFrom(h: Pick<Headers, "get">): string {
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim().slice(0, 64);
  const real = h.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const last = xff.split(",").at(-1)?.trim();
    if (last) return last.slice(0, 64);
  }
  return "unknown";
}

export async function requestContext(): Promise<{ ip: string; userAgent?: string }> {
  const h = await headers();
  return { ip: clientIpFrom(h), userAgent: h.get("user-agent") ?? undefined };
}

/** Only same-site paths inside the app may be used as a post-login destination. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== "string") return "/app";
  if (!next.startsWith("/app") || next.startsWith("//") || next.includes("\\")) return "/app";
  return next;
}
