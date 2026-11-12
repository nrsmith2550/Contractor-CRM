import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { withPlatform, withTenant } from "@/db/client";
import {
  adminAuditLog,
  adminSession,
  auditLog,
  license,
  passwordResetToken,
  platformAdmin,
  securityRole,
  systemUser,
} from "@/db/schema";
import { createPlatformAdmin } from "@/server/admin/bootstrap";
import {
  adminLogout,
  adminPasswordLogin,
  adminVerifyTotp,
  getAdminSession,
} from "@/server/admin/auth";
import {
  changeOwnerEmail,
  dashboardStats,
  getTenantDetail,
  issueOwnerTemporaryPassword,
  listAdminAudit,
  listLicenses,
  listTenants,
  mintLicenseAsAdmin,
  reactivateLicense,
  sendOwnerResetLink,
  setLicenseStatus,
  updateLicenseTier,
} from "@/server/admin/operations";
import { currentStep, totpCode } from "@/server/admin/totp";
import { activateLicense } from "@/server/auth/activation";
import { authenticate } from "@/server/auth/credentials";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { hashPassword } from "@/server/auth/password";
import { createSession, validateSession } from "@/server/auth/session";
import type { Email } from "@/server/email/mailer";
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const ADMIN_PASSWORD = "granite-harbor-compass-88";
const freshIp = () => `ip-${rand()}`;
const REASON = "Customer called support";
const GHOST = "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11";

beforeAll(() => {
  process.env.ADMIN_TOTP_KEY ??= randomBytes(32).toString("base64");
});

async function newAdmin() {
  const email = `admin-${rand()}@platform.test`;
  const created = await withPlatform((tx) =>
    createPlatformAdmin(tx, { email, password: ADMIN_PASSWORD }),
  );
  return { ...created, email };
}
const codeAt = (secret: Buffer, offset = 0) => totpCode(secret, currentStep() + offset);

/** Password step + one-time code → a verified admin session token. */
async function signInAdmin(a: { email: string; secret: Buffer }, offset = 0) {
  const ip = freshIp();
  const pw = await adminPasswordLogin({ email: a.email, password: ADMIN_PASSWORD, ip });
  if (!pw.ok) throw new Error("password step failed");
  const verify = await adminVerifyTotp({ token: pw.token, code: codeAt(a.secret, offset), ip });
  return { token: pw.token, verify, ip };
}

async function openPending(a: { email: string }) {
  const ip = freshIp();
  const pw = await adminPasswordLogin({ email: a.email, password: ADMIN_PASSWORD, ip });
  if (!pw.ok) throw new Error("password step failed");
  return { token: pw.token, ip };
}

async function newTenant(seatLimit?: number) {
  const { key } = await mintLicense({ tier: "team", seatLimit });
  const id = rand();
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Admin Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: freshIp(),
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { key, id, email, tenantId: res.tenantId, userId: res.userId };
}

const licenseOf = async (tenantId: string) =>
  (await withPlatform((tx) => tx.select().from(license).where(eq(license.tenantId, tenantId))))[0]!;
const auditFor = async (targetId: string) =>
  withPlatform((tx) => tx.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, targetId)));
const roleIdOf = async (tenantId: string, name: string) =>
  (
    await withTenant(tenantId, (tx) =>
      tx.select({ id: securityRole.id }).from(securityRole).where(eq(securityRole.name, name)),
    )
  )[0]!.id;

/** Invites and accepts a colleague so a business has pre-existing data to preserve. */
async function addColleague(t: { tenantId: string; userId: string }, email: string) {
  const mail: Email[] = [];
  await inviteUser(
    {
      tenantId: t.tenantId,
      inviterId: t.userId,
      email,
      roleId: await roleIdOf(t.tenantId, "Salesperson"),
    },
    { send: async (e) => void mail.push(e), appUrl: "https://app.test" },
  );
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)![1]!;
  const res = await acceptInvitation({
    token,
    values: { fullName: "Colleague", password: PASSWORD, confirmPassword: PASSWORD },
    ip: freshIp(),
  });
  if (!res.ok) throw new Error("accept failed");
  return res.userId;
}

describe.skipIf(!enabled)("Platform admin sign-in (password + mandatory TOTP)", () => {
  it("password alone never reaches the console; a valid code completes the sign-in", async () => {
    const a = await newAdmin();
    const { token, ip } = await openPending(a);

    expect(await getAdminSession(token)).toEqual({ ok: false, reason: "pending" });
    expect(await adminVerifyTotp({ token, code: codeAt(a.secret), ip })).toEqual({ ok: true });

    expect(await getAdminSession(token)).toMatchObject({
      ok: true,
      admin: { id: a.adminId, email: a.email },
    });
    expect(await getAdminSession("not-a-token")).toEqual({ ok: false, reason: "missing" });
    expect(await getAdminSession(undefined)).toEqual({ ok: false, reason: "missing" });
    expect((await auditFor(a.adminId)).map((r) => r.action)).toContain("admin.login");
  });

  it("gives one generic answer for a wrong password and an unknown admin", async () => {
    const a = await newAdmin();
    const wrong = await adminPasswordLogin({
      email: a.email,
      password: "wrong-password-123",
      ip: freshIp(),
    });
    const unknown = await adminPasswordLogin({
      email: `nobody-${rand()}@platform.test`,
      password: ADMIN_PASSWORD,
      ip: freshIp(),
    });
    expect(wrong).toMatchObject({ ok: false, code: "invalid_credentials" });
    expect(unknown).toMatchObject({ ok: false, code: "invalid_credentials" });
    expect(wrong.ok ? "" : wrong.message).toBe(unknown.ok ? "" : unknown.message);
  });

  it("an admin with no second factor enrolled can never sign in", async () => {
    const email = `nofa-${rand()}@platform.test`;
    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    await withPlatform((tx) => tx.insert(platformAdmin).values({ email, passwordHash }));
    expect(
      await adminPasswordLogin({ email, password: ADMIN_PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "invalid_credentials" });
  });

  it("rate-limits the password step: the 6th attempt for one admin is refused", async () => {
    const a = await newAdmin();
    for (let i = 0; i < 5; i++) {
      expect(
        await adminPasswordLogin({ email: a.email, password: "wrong-password-123", ip: freshIp() }),
      ).toMatchObject({ code: "invalid_credentials" });
    }
    expect(
      await adminPasswordLogin({ email: a.email, password: ADMIN_PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("a code can't be replayed, but the next step's code works", async () => {
    const a = await newAdmin();
    expect((await signInAdmin(a)).verify).toEqual({ ok: true });

    // A second sign-in using the very same (already accepted) code is refused.
    const second = await openPending(a);
    expect(
      await adminVerifyTotp({ token: second.token, code: codeAt(a.secret), ip: second.ip }),
    ).toMatchObject({ ok: false, code: "invalid_code" });
    // The following step is still acceptable (clock-drift window), so a real admin isn't locked out.
    expect(
      await adminVerifyTotp({ token: second.token, code: codeAt(a.secret, 1), ip: second.ip }),
    ).toEqual({ ok: true });
  });

  it("two simultaneous submissions of one code: exactly one session completes", async () => {
    const a = await newAdmin();
    const [s1, s2] = [await openPending(a), await openPending(a)];
    const code = codeAt(a.secret);
    const results = await Promise.all([
      adminVerifyTotp({ token: s1.token, code, ip: s1.ip }),
      adminVerifyTotp({ token: s2.token, code, ip: s2.ip }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("wrong codes are throttled per admin, even with the right code afterwards", async () => {
    const a = await newAdmin();
    const { token } = await openPending(a);
    for (let i = 0; i < 5; i++) {
      expect(await adminVerifyTotp({ token, code: "000000", ip: freshIp() })).toMatchObject({
        code: "invalid_code",
      });
    }
    expect(await adminVerifyTotp({ token, code: codeAt(a.secret), ip: freshIp() })).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
  });

  it("rejects malformed codes, a bad or missing session, and an expired pending session", async () => {
    const a = await newAdmin();
    const { token, ip } = await openPending(a);
    expect(await adminVerifyTotp({ token, code: "abc", ip })).toMatchObject({
      code: "invalid_code",
    });
    expect(await adminVerifyTotp({ token, code: undefined, ip })).toMatchObject({
      code: "invalid_code",
    });
    expect(await adminVerifyTotp({ token: undefined, code: "123456", ip })).toMatchObject({
      code: "invalid_session",
    });
    expect(await adminVerifyTotp({ token: "nope", code: "123456", ip })).toMatchObject({
      code: "invalid_session",
    });

    await withPlatform((tx) =>
      tx
        .update(adminSession)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(adminSession.adminId, a.adminId)),
    );
    expect(await adminVerifyTotp({ token, code: codeAt(a.secret), ip })).toMatchObject({
      code: "invalid_session",
    });
    expect(await getAdminSession(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("a verified session expires after 8 hours (absolute) and logout ends it", async () => {
    const a = await newAdmin();
    const s = await signInAdmin(a);
    const session = await getAdminSession(s.token);
    if (!session.ok) throw new Error("expected a session");
    const [row] = await withPlatform((tx) =>
      tx.select().from(adminSession).where(eq(adminSession.id, session.sessionId)),
    );
    const ttl = row!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(7.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(8 * 3600_000);

    await adminLogout(session.sessionId, a.adminId, s.ip);
    expect(await getAdminSession(s.token)).toEqual({ ok: false, reason: "missing" });

    const b = await signInAdmin(a, 1);
    const sb = await getAdminSession(b.token);
    if (!sb.ok) throw new Error("expected a session");
    await withPlatform((tx) =>
      tx
        .update(adminSession)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(adminSession.id, sb.sessionId)),
    );
    expect(await getAdminSession(b.token)).toEqual({ ok: false, reason: "expired" });
  });

  it("stores the password hashed and the TOTP secret encrypted", async () => {
    const a = await newAdmin();
    const [row] = await withPlatform((tx) =>
      tx.select().from(platformAdmin).where(eq(platformAdmin.id, a.adminId)),
    );
    expect(row!.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(row)).not.toContain(ADMIN_PASSWORD);
    expect(JSON.stringify(row)).not.toContain(a.secretBase32);
    expect(Buffer.from(row!.totpSecretEnc!, "base64").includes(a.secret)).toBe(false);
  });
});

describe.skipIf(!enabled)("Admin: licenses", () => {
  const ctx = async () => ({ adminId: (await newAdmin()).adminId, ip: "203.0.113.7" });

  it("mints a key (shown once) that really activates; reason is mandatory and audited", async () => {
    const c = await ctx();
    expect(await mintLicenseAsAdmin(c, { tier: "starter", reason: "x" })).toMatchObject({
      ok: false,
    });
    expect(await mintLicenseAsAdmin(c, { tier: "platinum", reason: REASON })).toMatchObject({
      ok: false,
    });
    expect(
      await mintLicenseAsAdmin(c, { tier: "starter", reason: REASON, seatLimit: "0" }),
    ).toMatchObject({ ok: false });
    expect(
      await mintLicenseAsAdmin(c, { tier: "starter", reason: REASON, buyerEmail: "nope" }),
    ).toMatchObject({ ok: false });

    const res = await mintLicenseAsAdmin(c, {
      tier: "enterprise",
      buyerEmail: "Reseller@Example.test",
      seatLimit: "250",
      reason: "Custom quote for ACME",
    });
    expect(res).toMatchObject({ ok: true });
    if (!res.ok) return;
    const [lic] = await withPlatform((tx) =>
      tx.select().from(license).where(eq(license.keyLast5, res.last5)),
    );
    expect(lic).toMatchObject({
      status: "issued",
      tier: "enterprise",
      seatLimit: 250,
      buyerEmail: "reseller@example.test",
    });

    const audit = await auditFor(lic!.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "license.mint",
      adminId: c.adminId,
      ip: "203.0.113.7",
      reason: "Custom quote for ACME",
    });
    expect(JSON.stringify(audit)).not.toContain(res.key);

    const id = rand();
    const act = await activateLicense({
      licenseKey: res.key,
      companyName: `Minted ${id}`,
      ownerName: "Sam Owner",
      ownerEmail: `minted-${id}@example.test`,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      timeZone: "UTC",
      currency: "USD",
      ip: freshIp(),
    });
    expect(act.ok).toBe(true);
  });

  it("suspend signs the tenant out on its next request; reinstate restores; revoke can be undone", async () => {
    const c = await ctx();
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const lic = await licenseOf(t.tenantId);
    const act = (action: string, reason = REASON) =>
      setLicenseStatus(c, { licenseId: lic.id, action, reason });
    expect((await validateSession(token)).ok).toBe(true);

    expect(await act("suspend", "")).toMatchObject({ ok: false });
    expect(await act("suspend", "Chargeback opened")).toEqual({ ok: true, status: "suspended" });
    expect(await validateSession(token)).toEqual({ ok: false, reason: "license_inactive" });
    expect(await act("suspend")).toMatchObject({ ok: false });

    expect(await act("reinstate", "Dispute won")).toEqual({ ok: true, status: "active" });
    expect((await validateSession(token)).ok).toBe(true);

    expect(await act("reinstate")).toMatchObject({ ok: false });
    expect(await act("revoke", "Refunded in full")).toEqual({ ok: true, status: "revoked" });
    expect(await act("revoke")).toMatchObject({ ok: false });
    expect(await validateSession(token)).toEqual({ ok: false, reason: "license_inactive" });

    const actions = (await auditFor(lic.id)).map((r) => r.action).sort();
    expect(actions).toEqual(["license.reinstate", "license.revoke", "license.suspend"]);
    expect(await act("delete")).toMatchObject({ ok: false });
    expect(
      await setLicenseStatus(c, { licenseId: "nope", action: "suspend", reason: REASON }),
    ).toMatchObject({ ok: false });
  });

  it("an unactivated license reinstates to 'issued', not 'active'", async () => {
    const c = await ctx();
    const { licenseId } = await mintLicense({ tier: "starter" });
    await setLicenseStatus(c, { licenseId, action: "suspend", reason: REASON });
    expect(await setLicenseStatus(c, { licenseId, action: "reinstate", reason: REASON })).toEqual({
      ok: true,
      status: "issued",
    });
  });

  it("changes tier/seats, but never below the users already active", async () => {
    const c = await ctx();
    const t = await newTenant(5);
    await addColleague(t, `two-${rand()}@example.test`); // two active users now
    const lic = await licenseOf(t.tenantId);

    expect(
      await updateLicenseTier(c, {
        licenseId: lic.id,
        tier: "starter",
        seatLimit: "1",
        reason: REASON,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await updateLicenseTier(c, { licenseId: lic.id, tier: "business", reason: "Comped upgrade" }),
    ).toEqual({ ok: true, tier: "business", seatLimit: 40 });
    expect(await licenseOf(t.tenantId)).toMatchObject({ tier: "business", seatLimit: 40 });
    const audit = (await auditFor(lic.id)).find((r) => r.action === "license.update_tier");
    expect(audit!.reason).toContain("Comped upgrade");
    expect(audit!.reason).toContain("business/40");
  });
});

describe.skipIf(!enabled)("Admin: owner recovery", () => {
  const ctx = async () => ({ adminId: (await newAdmin()).adminId, ip: "198.51.100.4" });

  it("send reset link: emails the owner, tags the link as admin-issued, signs the owner out, audits", async () => {
    const c = await ctx();
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const sent: Email[] = [];
    expect(await sendOwnerResetLink(c, { tenantId: t.tenantId, reason: "" })).toMatchObject({
      ok: false,
    });
    const res = await sendOwnerResetLink(
      c,
      { tenantId: t.tenantId, reason: REASON },
      { send: async (e) => void sent.push(e) },
    );
    expect(res).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(t.email);
    expect(sent[0]!.text).toContain("/reset-password?token=");

    const rows = await withTenant(t.tenantId, (tx) => tx.select().from(passwordResetToken));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.issuedBy).toBe("admin");
    expect(JSON.stringify(rows)).not.toContain(/token=([A-Za-z0-9_-]+)/.exec(sent[0]!.text)![1]!);
    expect(await validateSession(token)).toEqual({ ok: false, reason: "missing" });
    expect((await auditFor(t.tenantId)).map((r) => [r.action, r.adminId, r.reason])).toEqual([
      ["owner.send_reset_link", c.adminId, REASON],
    ]);
  });

  it("send reset link: if the email can't be sent nothing changes (the owner stays signed in)", async () => {
    const c = await ctx();
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sendOwnerResetLink(
      c,
      { tenantId: t.tenantId, reason: REASON },
      {
        send: async () => {
          throw new Error("down");
        },
      },
    );
    spy.mockRestore();
    expect(res).toMatchObject({ ok: false });
    expect((await validateSession(token)).ok).toBe(true);
    expect(await withTenant(t.tenantId, (tx) => tx.select().from(passwordResetToken))).toHaveLength(
      0,
    );
    expect(await auditFor(t.tenantId)).toHaveLength(0);
  });

  it("temporary password: shown once, forces a change, kills sessions, never stored or audited in the clear", async () => {
    const c = await ctx();
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const res = await issueOwnerTemporaryPassword(c, {
      tenantId: t.tenantId,
      reason: "Owner lost email access",
    });
    expect(res).toMatchObject({ ok: true, ownerEmail: t.email });
    if (!res.ok) return;
    expect(res.temporaryPassword).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);

    expect(await validateSession(token)).toEqual({ ok: false, reason: "missing" });
    expect(await authenticate({ email: t.email, password: PASSWORD, ip: freshIp() })).toMatchObject(
      { ok: false },
    );
    expect(
      await authenticate({ email: t.email, password: res.temporaryPassword, ip: freshIp() }),
    ).toMatchObject({ ok: true, mustChangePassword: true });

    const [u] = await withTenant(t.tenantId, (tx) =>
      tx.select().from(systemUser).where(eq(systemUser.id, t.userId)),
    );
    expect(JSON.stringify(u)).not.toContain(res.temporaryPassword);
    expect(JSON.stringify(await auditFor(t.tenantId))).not.toContain(res.temporaryPassword);
    const again = await issueOwnerTemporaryPassword(c, {
      tenantId: t.tenantId,
      reason: "Owner lost email access",
    });
    expect(again.ok && again.temporaryPassword).not.toBe(res.temporaryPassword);
  });

  it("change owner email: notifies old and new addresses, keeps the password, signs out, audits old → new", async () => {
    const c = await ctx();
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const sent: Email[] = [];
    const newEmail = `new-owner-${rand()}@example.test`;
    expect(
      await changeOwnerEmail(c, { tenantId: t.tenantId, newEmail: "nope", reason: REASON }),
    ).toMatchObject({ ok: false });
    const res = await changeOwnerEmail(
      c,
      { tenantId: t.tenantId, newEmail: newEmail.toUpperCase(), reason: "Owner left the company" },
      { send: async (e) => void sent.push(e) },
    );
    expect(res).toEqual({ ok: true, newEmail });
    expect(sent.map((e) => e.to).sort()).toEqual([newEmail, t.email].sort());

    expect(await validateSession(token)).toEqual({ ok: false, reason: "missing" });
    expect(await authenticate({ email: t.email, password: PASSWORD, ip: freshIp() })).toMatchObject(
      { ok: false },
    );
    expect(
      await authenticate({ email: newEmail, password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: true });
    const audit = (await auditFor(t.tenantId))[0]!;
    expect(audit.action).toBe("owner.change_email");
    expect(audit.reason).toContain(`${t.email} -> ${newEmail}`);
  });

  it("change owner email: refuses a taken or unchanged address; a failed notification rolls everything back", async () => {
    const c = await ctx();
    const a = await newTenant();
    const b = await newTenant();
    expect(
      await changeOwnerEmail(c, { tenantId: a.tenantId, newEmail: b.email, reason: REASON }),
    ).toMatchObject({ ok: false });
    expect(
      await changeOwnerEmail(c, { tenantId: a.tenantId, newEmail: a.email, reason: REASON }),
    ).toMatchObject({ ok: false });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await changeOwnerEmail(
      c,
      { tenantId: a.tenantId, newEmail: `x-${rand()}@example.test`, reason: REASON },
      {
        send: async () => {
          throw new Error("down");
        },
      },
    );
    spy.mockRestore();
    expect(res).toMatchObject({ ok: false });
    expect(await authenticate({ email: a.email, password: PASSWORD, ip: freshIp() })).toMatchObject(
      { ok: true },
    );
    expect(await auditFor(a.tenantId)).toHaveLength(0);
  });

  it("re-activate: the business keeps its data and a new owner claims it with the same key", async () => {
    const c = await ctx();
    const t = await newTenant(5);
    const colleagueEmail = `colleague-${rand()}@example.test`;
    const colleagueId = await addColleague(t, colleagueEmail); // pre-existing data
    const colleagueSession = await createSession({ tenantId: t.tenantId, userId: colleagueId });
    const ownerSession = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const before = await licenseOf(t.tenantId);

    expect(await reactivateLicense(c, { tenantId: t.tenantId, reason: "" })).toMatchObject({
      ok: false,
    });
    expect(
      await reactivateLicense(c, {
        tenantId: t.tenantId,
        reason: "Owner died; estate contact is taking over",
      }),
    ).toEqual({ ok: true });

    expect(await licenseOf(t.tenantId)).toMatchObject({ status: "issued", tenantId: t.tenantId });
    expect(await validateSession(ownerSession.token)).toEqual({ ok: false, reason: "missing" });
    expect(await validateSession(colleagueSession.token)).toEqual({
      ok: false,
      reason: "missing",
    });
    // Nobody can sign in until the key is claimed again.
    expect(
      await authenticate({ email: colleagueEmail, password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: false, code: "license_inactive" });
    expect(await authenticate({ email: t.email, password: PASSWORD, ip: freshIp() })).toMatchObject(
      { ok: false },
    );

    // The new owner uses the ORIGINAL address: it was freed when the old owner was disabled.
    const NEW_PASSWORD = "granite-meadow-lantern-55";
    const claim = await activateLicense({
      licenseKey: t.key,
      companyName: "Ignored on re-activation",
      ownerName: "New Owner",
      ownerEmail: t.email,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      timeZone: "UTC",
      currency: "USD",
      ip: freshIp(),
    });
    expect(claim).toMatchObject({ ok: true, tenantId: t.tenantId });
    const after = await licenseOf(t.tenantId);
    expect(after).toMatchObject({ status: "active", tenantId: t.tenantId });
    expect(after.activatedAt).toEqual(before.activatedAt);

    await withTenant(t.tenantId, async (tx) => {
      expect(await tx.select().from(securityRole)).toHaveLength(6); // not duplicated
      const users = await tx.select().from(systemUser);
      expect(users.map((u) => u.fullName).sort()).toEqual([
        "Colleague",
        "Jordan Rivers",
        "New Owner",
      ]);
      expect(users.filter((u) => u.isOwner && !u.disabledAt)).toHaveLength(1);
      const former = users.find((u) => u.fullName === "Jordan Rivers")!;
      expect(former.disabledAt).toBeInstanceOf(Date);
      expect(former.isOwner).toBe(false);
      expect(former.email).toContain("+former-");
      expect(
        await tx.select().from(auditLog).where(eq(auditLog.action, "reactivate")),
      ).toHaveLength(1);
    });
    expect(
      await authenticate({ email: colleagueEmail, password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: true });
    expect(
      await authenticate({ email: t.email, password: NEW_PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: true });
    expect((await auditFor(t.tenantId)).map((r) => r.action)).toContain("license.reactivate");
  });

  it("re-activate refuses a license that isn't active; every owner action refuses unknown businesses", async () => {
    const c = await ctx();
    const t = await newTenant();
    await withPlatform((tx) =>
      tx.update(license).set({ status: "suspended" }).where(eq(license.tenantId, t.tenantId)),
    );
    expect(await reactivateLicense(c, { tenantId: t.tenantId, reason: REASON })).toMatchObject({
      ok: false,
    });

    expect(await sendOwnerResetLink(c, { tenantId: GHOST, reason: REASON })).toMatchObject({
      ok: false,
    });
    expect(await issueOwnerTemporaryPassword(c, { tenantId: GHOST, reason: REASON })).toMatchObject(
      { ok: false },
    );
    expect(
      await changeOwnerEmail(c, { tenantId: GHOST, newEmail: "a@b.test", reason: REASON }),
    ).toMatchObject({ ok: false });
    expect(await reactivateLicense(c, { tenantId: GHOST, reason: REASON })).toMatchObject({
      ok: false,
    });
    expect(
      await issueOwnerTemporaryPassword(c, { tenantId: "not-a-uuid", reason: REASON }),
    ).toMatchObject({ ok: false });
  });
});

describe.skipIf(!enabled)("Admin: lists and audit log", () => {
  it("lists and filters licenses and tenants, and shows the owner of each business", async () => {
    const t = await newTenant();
    const lic = await licenseOf(t.tenantId);
    await withPlatform((tx) =>
      tx
        .update(license)
        .set({ buyerEmail: `buyer-${t.id}@example.test` })
        .where(eq(license.id, lic.id)),
    );

    const byBuyer = await listLicenses({ q: `buyer-${t.id}` });
    expect(byBuyer).toHaveLength(1);
    expect(byBuyer[0]).toMatchObject({
      id: lic.id,
      status: "active",
      tenantName: `Admin Co ${t.id}`,
    });
    expect(await listLicenses({ q: `Admin Co ${t.id}`, status: "active" })).toHaveLength(1);
    expect(await listLicenses({ q: `Admin Co ${t.id}`, status: "revoked" })).toHaveLength(0);
    expect((await listLicenses({ status: "bogus-status" })).length).toBeGreaterThan(0); // ignored

    const tenants = await listTenants();
    expect(tenants.find((x) => x.id === t.tenantId)).toMatchObject({
      ownerEmail: t.email,
      activeUsers: 1,
      licenseStatus: "active",
    });
    expect(await getTenantDetail(t.tenantId)).toMatchObject({
      name: `Admin Co ${t.id}`,
      owner: { email: t.email },
      activeUsers: 1,
      tier: "team",
    });
    expect(await getTenantDetail(GHOST)).toBeNull();

    const stats = await dashboardStats();
    expect(stats.tenants).toBeGreaterThan(0);
    expect(stats.active).toBeGreaterThan(0);
  });

  it("the audit log shows who did what, newest first, and is append-only", async () => {
    const a = await newAdmin();
    const t = await newTenant();
    await setLicenseStatus(
      { adminId: a.adminId, ip: "203.0.113.9" },
      {
        licenseId: (await licenseOf(t.tenantId)).id,
        action: "suspend",
        reason: "Looking into abuse reports",
      },
    );
    const log = await listAdminAudit(50);
    const entry = log.find((e) => e.action === "license.suspend" && e.adminEmail === a.email);
    expect(entry).toMatchObject({
      reason: "Looking into abuse reports",
      ip: "203.0.113.9",
      targetType: "license",
    });
    for (let i = 1; i < log.length; i++) {
      expect(log[i - 1]!.at.getTime()).toBeGreaterThanOrEqual(log[i]!.at.getTime());
    }

    await expect(
      withPlatform((tx) =>
        tx.update(adminAuditLog).set({ reason: "edited" }).where(eq(adminAuditLog.id, entry!.id)),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withPlatform((tx) => tx.delete(adminAuditLog).where(eq(adminAuditLog.id, entry!.id))),
    ).rejects.toBeTruthy();
  });
});
