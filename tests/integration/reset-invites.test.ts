import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withPlatform, withTenant } from "@/db/client";
import {
  invitation,
  license,
  passwordResetToken,
  securityRole,
  session,
  systemUser,
  userRole,
} from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { authenticate } from "@/server/auth/credentials";
import {
  acceptInvitation,
  getInvitationPreview,
  inviteUser,
  listPendingInvitations,
  revokeInvitation,
} from "@/server/auth/invitations";
import { isResetTokenUsable, requestPasswordReset, resetPassword } from "@/server/auth/reset";
import { createSession, validateSession } from "@/server/auth/session";
import type { Email } from "@/server/email/mailer";
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const NEW_PASSWORD = "copper-meadow-lantern-77";
const APP_URL = "https://app.example.test";
const freshIp = () => `ip-${rand()}`;
const tokenFrom = (e: Email) => /token=([A-Za-z0-9_-]+)/.exec(e.text)![1]!;

async function newOwner(seatLimit?: number) {
  const { key } = await mintLicense({ tier: "team", seatLimit });
  const id = rand();
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Reset Co ${id}`,
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

const setSeats = (tenantId: string, seatLimit: number) =>
  withPlatform((tx) => tx.update(license).set({ seatLimit }).where(eq(license.tenantId, tenantId)));

const roleId = async (tenantId: string, name: string) =>
  (
    await withTenant(tenantId, (tx) =>
      tx.select({ id: securityRole.id }).from(securityRole).where(eq(securityRole.name, name)),
    )
  )[0]!.id;

function mailbox() {
  const sent: Email[] = [];
  const send = vi.fn(async (e: Email) => {
    sent.push(e);
  });
  return { sent, send };
}

describe.skipIf(!enabled)("Forgot / reset password (real Postgres)", () => {
  async function requestFor(o: { email: string }) {
    const m = mailbox();
    const res = await requestPasswordReset(
      { email: o.email, ip: freshIp() },
      { send: m.send, appUrl: APP_URL },
    );
    return { res, m };
  }

  it("emails a single-use link to a known user; only the token's hash is stored", async () => {
    const o = await newOwner();
    const { res, m } = await requestFor(o);
    expect(res).toEqual({ ok: true });
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]!.to).toBe(o.email);
    expect(m.sent[0]!.text).toContain(`${APP_URL}/reset-password?token=`);

    const token = tokenFrom(m.sent[0]!);
    const rows = await withTenant(o.tenantId, (tx) => tx.select().from(passwordResetToken));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0]!.issuedBy).toBe("self");
    const ttl = rows[0]!.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
  });

  it("answers identically for unknown, disabled and suspended accounts, and sends nothing", async () => {
    const unknown = mailbox();
    const r1 = await requestPasswordReset(
      { email: `nobody-${rand()}@example.test`, ip: freshIp() },
      { send: unknown.send, appUrl: APP_URL },
    );
    const disabled = await newOwner();
    await withTenant(disabled.tenantId, (tx) =>
      tx
        .update(systemUser)
        .set({ disabledAt: new Date() })
        .where(eq(systemUser.id, disabled.userId)),
    );
    const r2 = await requestFor(disabled);
    const suspended = await newOwner();
    await withPlatform((tx) =>
      tx
        .update(license)
        .set({ status: "suspended" })
        .where(eq(license.tenantId, suspended.tenantId)),
    );
    const r3 = await requestFor(suspended);

    for (const r of [r1, r2.res, r3.res]) expect(r).toEqual({ ok: true });
    expect(unknown.sent).toHaveLength(0);
    expect(r2.m.sent).toHaveLength(0);
    expect(r3.m.sent).toHaveLength(0);
  });

  it("does not reveal a delivery failure to the caller", async () => {
    const o = await newOwner();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await requestPasswordReset(
      { email: o.email, ip: freshIp() },
      {
        send: async () => {
          throw new Error("provider down");
        },
        appUrl: APP_URL,
      },
    );
    spy.mockRestore();
    expect(res).toEqual({ ok: true });
  });

  it("rate-limits requests per address: the 6th in 15 minutes is refused", async () => {
    const o = await newOwner();
    const m = mailbox();
    const again = () =>
      requestPasswordReset({ email: o.email, ip: freshIp() }, { send: m.send, appUrl: APP_URL });
    for (let i = 0; i < 5; i++) expect(await again()).toEqual({ ok: true });
    expect(await again()).toMatchObject({ ok: false, code: "rate_limited" });
  });

  it("a new request invalidates the previous link", async () => {
    const o = await newOwner();
    const first = await requestFor(o);
    const second = await requestFor(o);
    const t1 = tokenFrom(first.m.sent[0]!);
    const t2 = tokenFrom(second.m.sent[0]!);
    expect(await isResetTokenUsable(t1)).toBe(false);
    expect(await isResetTokenUsable(t2)).toBe(true);
  });

  it("resets the password, signs out every session, clears the forced flag, and works once", async () => {
    const o = await newOwner();
    const live = await createSession({ tenantId: o.tenantId, userId: o.userId });
    await withTenant(o.tenantId, (tx) =>
      tx.update(systemUser).set({ mustChangePassword: true }).where(eq(systemUser.id, o.userId)),
    );
    const { m } = await requestFor(o);
    const token = tokenFrom(m.sent[0]!);

    const res = await resetPassword({
      token,
      password: NEW_PASSWORD,
      confirmPassword: NEW_PASSWORD,
      ip: freshIp(),
    });
    expect(res).toEqual({ ok: true });

    expect(await validateSession(live.token)).toEqual({ ok: false, reason: "missing" });
    expect(await authenticate({ email: o.email, password: PASSWORD, ip: freshIp() })).toMatchObject(
      { ok: false },
    );
    expect(
      await authenticate({ email: o.email, password: NEW_PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: true, mustChangePassword: false });

    // The link is spent.
    expect(await isResetTokenUsable(token)).toBe(false);
    expect(
      await resetPassword({
        token,
        password: "another-long-secret-9",
        confirmPassword: "another-long-secret-9",
        ip: freshIp(),
      }),
    ).toMatchObject({ ok: false, code: "invalid_token" });
  });

  it("a weak password or mismatch does not spend the link", async () => {
    const o = await newOwner();
    const { m } = await requestFor(o);
    const token = tokenFrom(m.sent[0]!);
    expect(
      await resetPassword({
        token,
        password: "password1234",
        confirmPassword: "password1234",
        ip: freshIp(),
      }),
    ).toMatchObject({ ok: false, code: "weak_password" });
    expect(
      await resetPassword({
        token,
        password: NEW_PASSWORD,
        confirmPassword: "different-12345",
        ip: freshIp(),
      }),
    ).toMatchObject({ ok: false, code: "mismatch" });
    expect(await isResetTokenUsable(token)).toBe(true);
    expect(
      await resetPassword({
        token,
        password: NEW_PASSWORD,
        confirmPassword: NEW_PASSWORD,
        ip: freshIp(),
      }),
    ).toEqual({ ok: true });
  });

  it("rejects expired, unknown and malformed links", async () => {
    const o = await newOwner();
    const { m } = await requestFor(o);
    const token = tokenFrom(m.sent[0]!);
    await withTenant(o.tenantId, (tx) =>
      tx.update(passwordResetToken).set({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await isResetTokenUsable(token)).toBe(false);
    for (const bad of [token, "not-a-real-token", ""]) {
      expect(
        await resetPassword({
          token: bad,
          password: NEW_PASSWORD,
          confirmPassword: NEW_PASSWORD,
          ip: freshIp(),
        }),
      ).toMatchObject({ ok: false, code: "invalid_token" });
    }
    expect(await isResetTokenUsable(undefined)).toBe(false);
  });

  it("two simultaneous submissions of one link: exactly one wins", async () => {
    const o = await newOwner();
    const { m } = await requestFor(o);
    const token = tokenFrom(m.sent[0]!);
    const attempt = (pw: string) =>
      resetPassword({ token, password: pw, confirmPassword: pw, ip: freshIp() });
    const results = await Promise.all([
      attempt("first-winner-pass-11"),
      attempt("second-winner-pass-22"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("Invitations (real Postgres)", () => {
  async function invite(
    o: { tenantId: string; userId: string },
    email: string,
    role = "Salesperson",
  ) {
    const m = mailbox();
    const res = await inviteUser(
      { tenantId: o.tenantId, inviterId: o.userId, email, roleId: await roleId(o.tenantId, role) },
      { send: m.send, appUrl: APP_URL },
    );
    return { res, m };
  }
  const accept = (token: string, name = "Sam Invitee", pw = PASSWORD) =>
    acceptInvitation({
      token,
      values: { fullName: name, password: pw, confirmPassword: pw },
      ip: freshIp(),
    });

  it("invites, emails a link, and the invitee joins with the chosen role and can sign in", async () => {
    const o = await newOwner();
    const email = `invitee-${rand()}@example.test`;
    const { res, m } = await invite(o, email);
    expect(res).toMatchObject({ ok: true });
    expect(m.sent[0]).toMatchObject({ to: email });
    expect(m.sent[0]!.text).toContain("Reset Co");
    const token = tokenFrom(m.sent[0]!);

    const stored = await withTenant(o.tenantId, (tx) => tx.select().from(invitation));
    expect(JSON.stringify(stored)).not.toContain(token); // hash only

    expect(await getInvitationPreview(token)).toMatchObject({ email });
    const joined = await accept(token);
    expect(joined).toMatchObject({ ok: true, tenantId: o.tenantId });
    if (!joined.ok) return;

    const [user] = await withTenant(o.tenantId, (tx) =>
      tx.select().from(systemUser).where(eq(systemUser.id, joined.userId)),
    );
    expect(user).toMatchObject({ email, isOwner: false, mustChangePassword: false });
    expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
    const [link] = await withTenant(o.tenantId, (tx) =>
      tx
        .select({ name: securityRole.name })
        .from(userRole)
        .innerJoin(securityRole, eq(userRole.roleId, securityRole.id))
        .where(eq(userRole.userId, joined.userId)),
    );
    expect(link!.name).toBe("Salesperson");
    expect(await authenticate({ email, password: PASSWORD, ip: freshIp() })).toMatchObject({
      ok: true,
    });

    // Single use.
    expect(await accept(token)).toMatchObject({ ok: false, code: "invalid_token" });
    expect(await getInvitationPreview(token)).toBeNull();
  });

  it("enforces the seat limit at invite time with an upgrade prompt, and revoking frees the seat", async () => {
    const o = await newOwner(2); // owner + one more
    const a = await invite(o, `a-${rand()}@example.test`);
    expect(a.res.ok).toBe(true);
    const b = await invite(o, `b-${rand()}@example.test`);
    expect(b.res).toMatchObject({ ok: false, code: "seat_limit" });
    expect(b.res.ok ? "" : b.res.message).toContain("Upgrade your license");
    expect(b.m.sent).toHaveLength(0);

    if (a.res.ok) {
      expect(
        await revokeInvitation({
          tenantId: o.tenantId,
          invitationId: a.res.invitationId,
          actorId: o.userId,
        }),
      ).toBe(true);
      expect(await getInvitationPreview(tokenFrom(a.m.sent[0]!))).toBeNull();
    }
    expect((await invite(o, `c-${rand()}@example.test`)).res.ok).toBe(true);
  });

  it("seats count active users: a disabled user frees a seat", async () => {
    const o = await newOwner(2);
    const first = await invite(o, `u-${rand()}@example.test`);
    const joined = await accept(tokenFrom(first.m.sent[0]!));
    if (!joined.ok) throw new Error("accept failed");
    expect((await invite(o, `v-${rand()}@example.test`)).res).toMatchObject({
      ok: false,
      code: "seat_limit",
    });

    await withTenant(o.tenantId, (tx) =>
      tx.update(systemUser).set({ disabledAt: new Date() }).where(eq(systemUser.id, joined.userId)),
    );
    expect((await invite(o, `w-${rand()}@example.test`)).res.ok).toBe(true);
  });

  it("re-checks seats when the invitation is accepted and does not consume it on failure", async () => {
    const o = await newOwner(2);
    const inv = await invite(o, `late-${rand()}@example.test`);
    const token = tokenFrom(inv.m.sent[0]!);
    await setSeats(o.tenantId, 1); // license shrank after the invite went out
    expect(await accept(token)).toMatchObject({ ok: false, code: "seat_limit" });
    const [row] = await withTenant(o.tenantId, (tx) => tx.select().from(invitation));
    expect(row!.acceptedAt).toBeNull();
    await setSeats(o.tenantId, 2);
    expect((await accept(token)).ok).toBe(true);
  });

  it("refuses addresses that already have an account, with identical wording across businesses", async () => {
    const a = await newOwner();
    const b = await newOwner();
    const same = await invite(a, a.email);
    const other = await invite(a, b.email);
    expect(same.res).toMatchObject({ ok: false, code: "unavailable" });
    expect(other.res).toMatchObject({ ok: false, code: "unavailable" });
    expect(same.res.ok ? "" : same.res.message).toBe(other.res.ok ? "" : other.res.message);
  });

  it("rejects a role that isn't this business's, and malformed input", async () => {
    const a = await newOwner();
    const b = await newOwner();
    const foreignRole = await roleId(b.tenantId, "Salesperson");
    const m = mailbox();
    expect(
      await inviteUser(
        {
          tenantId: a.tenantId,
          inviterId: a.userId,
          email: `x-${rand()}@example.test`,
          roleId: foreignRole,
        },
        { send: m.send },
      ),
    ).toMatchObject({ ok: false, code: "invalid_role" });
    expect(
      await inviteUser(
        { tenantId: a.tenantId, inviterId: a.userId, email: "nope", roleId: "nope" },
        { send: m.send },
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(m.sent).toHaveLength(0);
  });

  it("a newer invitation to the same address replaces the older one", async () => {
    const o = await newOwner();
    const email = `dup-${rand()}@example.test`;
    const first = await invite(o, email);
    const second = await invite(o, email);
    expect(await getInvitationPreview(tokenFrom(first.m.sent[0]!))).toBeNull();
    expect(await getInvitationPreview(tokenFrom(second.m.sent[0]!))).toMatchObject({ email });
    expect(await listPendingInvitations(o.tenantId)).toHaveLength(1);
  });

  it("stores nothing if the email can't be sent", async () => {
    const o = await newOwner();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await inviteUser(
      {
        tenantId: o.tenantId,
        inviterId: o.userId,
        email: `f-${rand()}@example.test`,
        roleId: await roleId(o.tenantId, "Salesperson"),
      },
      {
        send: async () => {
          throw new Error("provider down");
        },
      },
    );
    spy.mockRestore();
    expect(res).toMatchObject({ ok: false, code: "email_failed" });
    expect(await listPendingInvitations(o.tenantId)).toHaveLength(0);
  });

  it("a weak password keeps the invitation open; an expired one is dead", async () => {
    const o = await newOwner();
    const inv = await invite(o, `exp-${rand()}@example.test`);
    const token = tokenFrom(inv.m.sent[0]!);
    expect(await accept(token, "Sam", "password1234")).toMatchObject({
      ok: false,
      code: "weak_password",
    });
    expect(await getInvitationPreview(token)).not.toBeNull(); // still open

    await withTenant(o.tenantId, (tx) =>
      tx.update(invitation).set({ expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(await getInvitationPreview(token)).toBeNull();
    expect(await accept(token)).toMatchObject({ ok: false, code: "invalid_token" });
  });

  it("an inactive license can't accept new members", async () => {
    const o = await newOwner();
    const inv = await invite(o, `inactive-${rand()}@example.test`);
    await withPlatform((tx) =>
      tx.update(license).set({ status: "suspended" }).where(eq(license.tenantId, o.tenantId)),
    );
    expect(await accept(tokenFrom(inv.m.sent[0]!))).toMatchObject({
      ok: false,
      code: "license_inactive",
    });
  });

  it("two simultaneous accepts of one invitation: exactly one account is created", async () => {
    const o = await newOwner(5);
    const email = `race-${rand()}@example.test`;
    const inv = await invite(o, email);
    const token = tokenFrom(inv.m.sent[0]!);
    const results = await Promise.all([accept(token, "Racer One"), accept(token, "Racer Two")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const users = await withTenant(o.tenantId, (tx) =>
      tx.select().from(systemUser).where(eq(systemUser.email, email)),
    );
    expect(users).toHaveLength(1);
  });

  it("tenant isolation: another business can neither list nor revoke these invitations", async () => {
    const a = await newOwner();
    const b = await newOwner();
    const inv = await invite(a, `iso-${rand()}@example.test`);
    expect(await listPendingInvitations(b.tenantId)).toHaveLength(0);
    if (inv.res.ok) {
      expect(
        await revokeInvitation({
          tenantId: b.tenantId,
          invitationId: inv.res.invitationId,
          actorId: b.userId,
        }),
      ).toBe(false);
    }
    expect(await listPendingInvitations(a.tenantId)).toHaveLength(1);
    const rows = await withTenant(b.tenantId, (tx) =>
      tx
        .select()
        .from(session)
        .where(and(eq(session.tenantId, a.tenantId))),
    );
    expect(rows).toEqual([]);
  });
});
