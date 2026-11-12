import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withPlatform, withTenant } from "@/db/client";
import { auditLog, authEvent, license, session, systemUser } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { authenticate, changePassword } from "@/server/auth/credentials";
import { createSession, validateSession } from "@/server/auth/session";
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const NEW_PASSWORD = "copper-meadow-lantern-77";
const WRONG = "wrong-password-12";
const freshIp = () => `ip-${rand()}`;

async function newOwner() {
  const { key } = await mintLicense({ tier: "team" });
  const id = rand();
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Login Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: freshIp(),
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { email, tenantId: res.tenantId, userId: res.userId };
}

describe.skipIf(!enabled)("Sign-in and password change (real Postgres)", () => {
  it("signs in with email + password (email case-insensitive) and the session validates", async () => {
    const o = await newOwner();
    const res = await authenticate({
      email: o.email.toUpperCase(),
      password: PASSWORD,
      ip: freshIp(),
      userAgent: "vitest",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({
      tenantId: o.tenantId,
      userId: o.userId,
      mustChangePassword: false,
    });
    const check = await validateSession(res.token);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.user).toMatchObject({ email: o.email, isOwner: true });
  });

  it("gives the same generic answer for a wrong password and an unknown email, and logs neither", async () => {
    const o = await newOwner();
    const ip = freshIp();
    const wrong = await authenticate({ email: o.email, password: "not-the-password-1", ip });
    const unknown = await authenticate({
      email: `nobody-${rand()}@example.test`,
      password: PASSWORD,
      ip,
    });
    expect(wrong).toMatchObject({ ok: false, code: "invalid_credentials" });
    expect(unknown).toMatchObject({ ok: false, code: "invalid_credentials" });
    expect(wrong.ok ? "" : wrong.message).toBe(unknown.ok ? "" : unknown.message);

    const events = await withPlatform((tx) =>
      tx.select().from(authEvent).where(eq(authEvent.ip, ip)),
    );
    expect(events.map((e) => e.kind)).toEqual(["login_failed", "login_failed"]);
    const dump = JSON.stringify(events);
    expect(dump).not.toContain(o.email);
    expect(dump).not.toContain("not-the-password");
  });

  it("rejects malformed input without touching the database", async () => {
    expect(
      await authenticate({ email: "not-an-email", password: "x", ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await authenticate({ email: undefined, password: undefined, ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rate-limits per email: the 11th attempt in 15 minutes is blocked even from fresh IPs", async () => {
    const o = await newOwner();
    for (let i = 0; i < 10; i++) {
      const r = await authenticate({ email: o.email, password: WRONG, ip: freshIp() });
      expect(r).toMatchObject({ ok: false, code: "invalid_credentials" });
    }
    // Even the correct password is refused while throttled.
    expect(await authenticate({ email: o.email, password: PASSWORD, ip: freshIp() })).toMatchObject(
      { ok: false, code: "rate_limited" },
    );
  });

  it("rate-limits per IP across different emails", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      await authenticate({ email: `u${i}-${rand()}@example.test`, password: WRONG, ip });
    }
    expect(
      await authenticate({ email: `u-${rand()}@example.test`, password: WRONG, ip }),
    ).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("reveals a disabled account or inactive license only after the correct password", async () => {
    const disabled = await newOwner();
    await withTenant(disabled.tenantId, (tx) =>
      tx
        .update(systemUser)
        .set({ disabledAt: new Date() })
        .where(eq(systemUser.id, disabled.userId)),
    );
    expect(
      await authenticate({ email: disabled.email, password: WRONG, ip: freshIp() }),
    ).toMatchObject({ code: "invalid_credentials" });
    expect(
      await authenticate({ email: disabled.email, password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "disabled" });

    const suspended = await newOwner();
    await withPlatform((tx) =>
      tx
        .update(license)
        .set({ status: "suspended" })
        .where(eq(license.tenantId, suspended.tenantId)),
    );
    expect(
      await authenticate({ email: suspended.email, password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "license_inactive" });
  });

  it("flags a forced password change (admin temporary password)", async () => {
    const o = await newOwner();
    await withTenant(o.tenantId, (tx) =>
      tx.update(systemUser).set({ mustChangePassword: true }).where(eq(systemUser.id, o.userId)),
    );
    const res = await authenticate({ email: o.email, password: PASSWORD, ip: freshIp() });
    expect(res).toMatchObject({ ok: true, mustChangePassword: true });
  });

  describe("changePassword", () => {
    async function twoSessions() {
      const o = await newOwner();
      const a = await createSession({ tenantId: o.tenantId, userId: o.userId });
      const b = await createSession({ tenantId: o.tenantId, userId: o.userId });
      const check = await validateSession(a.token);
      if (!check.ok) throw new Error("session invalid");
      return { o, a, b, sessionId: check.user.sessionId };
    }

    it("changes the password, clears the forced flag, keeps this session and signs out the rest", async () => {
      const { o, a, b, sessionId } = await twoSessions();
      await withTenant(o.tenantId, (tx) =>
        tx.update(systemUser).set({ mustChangePassword: true }).where(eq(systemUser.id, o.userId)),
      );

      const res = await changePassword({
        tenantId: o.tenantId,
        userId: o.userId,
        sessionId,
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
      });
      expect(res).toEqual({ ok: true });

      expect((await validateSession(a.token)).ok).toBe(true);
      expect(await validateSession(b.token)).toEqual({ ok: false, reason: "missing" });

      const [u] = await withTenant(o.tenantId, (tx) =>
        tx.select().from(systemUser).where(eq(systemUser.id, o.userId)),
      );
      expect(u!.mustChangePassword).toBe(false);
      expect(u!.passwordHash.startsWith("$argon2id$")).toBe(true);

      expect(
        await authenticate({ email: o.email, password: PASSWORD, ip: freshIp() }),
      ).toMatchObject({ ok: false });
      expect(
        await authenticate({ email: o.email, password: NEW_PASSWORD, ip: freshIp() }),
      ).toMatchObject({ ok: true, mustChangePassword: false });

      const audit = await withTenant(o.tenantId, (tx) =>
        tx.select().from(auditLog).where(eq(auditLog.action, "change_password")),
      );
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain(NEW_PASSWORD);
    });

    it("refuses a wrong current password, a weak or reused new password, and a mismatch", async () => {
      const { o, sessionId } = await twoSessions();
      const base = { tenantId: o.tenantId, userId: o.userId, sessionId };

      expect(
        await changePassword({
          ...base,
          currentPassword: "nope-nope-nope-1",
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        }),
      ).toMatchObject({ ok: false, code: "wrong_password" });
      expect(
        await changePassword({
          ...base,
          currentPassword: PASSWORD,
          newPassword: "password1234",
          confirmPassword: "password1234",
        }),
      ).toMatchObject({ ok: false, code: "weak_password" });
      expect(
        await changePassword({
          ...base,
          currentPassword: PASSWORD,
          newPassword: PASSWORD,
          confirmPassword: PASSWORD,
        }),
      ).toMatchObject({ ok: false, code: "weak_password" });
      expect(
        await changePassword({
          ...base,
          currentPassword: PASSWORD,
          newPassword: NEW_PASSWORD,
          confirmPassword: "different-12345",
        }),
      ).toMatchObject({ ok: false, code: "mismatch" });

      // Nothing changed: the old password still works and both sessions survive.
      expect((await authenticate({ email: o.email, password: PASSWORD, ip: freshIp() })).ok).toBe(
        true,
      );
      const rows = await withTenant(o.tenantId, (tx) => tx.select().from(session));
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it("throttles guesses of the current password", async () => {
      const { o, sessionId } = await twoSessions();
      const attempt = () =>
        changePassword({
          tenantId: o.tenantId,
          userId: o.userId,
          sessionId,
          currentPassword: "guess-guess-guess-1",
          newPassword: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
        });
      for (let i = 0; i < 10; i++) {
        expect(await attempt()).toMatchObject({ code: "wrong_password" });
      }
      expect(await attempt()).toMatchObject({ ok: false, code: "rate_limited" });
    });
  });
});
