import { randomBytes } from "node:crypto";
import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { setTenant, withPlatform, withTenant, type Tx } from "@/db/client";
import {
  adminAuditLog,
  license,
  passwordResetToken,
  platformAdmin,
  session,
  systemUser,
  tenant,
} from "@/db/schema";
import { emailField } from "@/lib/validation/auth";
import { TIERS, type Tier, isTier } from "@/lib/tiers";
import { hashPassword } from "@/server/auth/password";
import { hashToken, newToken } from "@/server/auth/tokens";
import { sendEmail } from "@/server/email/mailer";
import { passwordResetEmail } from "@/server/email/templates";
import { mintLicense } from "@/server/licensing/mint";
import { KEY_ALPHABET } from "@/server/auth/license-key";
import { writeAdminAudit } from "./audit";

export type AdminCtx = { adminId: string; ip: string };
type Ok<T> = { ok: true } & T;
type Fail = { ok: false; message: string };
export type OpResult<T = object> = Ok<T> | Fail;

const fail = (message: string): Fail => ({ ok: false, message });

/** Every consequential admin action needs a human-readable reason, kept in the audit log. */
const reasonSchema = z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500);
const parseReason = (raw: unknown): { ok: true; reason: string } | Fail => {
  const r = reasonSchema.safeParse(raw);
  return r.success ? { ok: true, reason: r.data } : fail(r.error.issues[0]!.message);
};

class Abort extends Error {}

// ───────────────────────────── reads ─────────────────────────────

export async function dashboardStats() {
  return withPlatform(async (tx) => {
    const byStatus = await tx
      .select({ status: license.status, n: count() })
      .from(license)
      .groupBy(license.status);
    const [tenants] = await tx.select({ n: count() }).from(tenant);
    const get = (s: string) => byStatus.find((r) => r.status === s)?.n ?? 0;
    return {
      tenants: tenants!.n,
      issued: get("issued"),
      active: get("active"),
      suspended: get("suspended"),
      revoked: get("revoked"),
    };
  });
}

export async function listLicenses(filter: { q?: string; status?: string } = {}) {
  const q = filter.q?.trim();
  const status = ["issued", "active", "suspended", "revoked"].includes(filter.status ?? "")
    ? (filter.status as "issued" | "active" | "suspended" | "revoked")
    : undefined;
  return withPlatform((tx) =>
    tx
      .select({
        id: license.id,
        keyLast5: license.keyLast5,
        tier: license.tier,
        seatLimit: license.seatLimit,
        status: license.status,
        amountPaidCents: license.amountPaidCents,
        buyerEmail: license.buyerEmail,
        tenantId: license.tenantId,
        tenantName: tenant.name,
        activatedAt: license.activatedAt,
        createdAt: license.createdAt,
      })
      .from(license)
      .leftJoin(tenant, eq(license.tenantId, tenant.id))
      .where(
        and(
          status ? eq(license.status, status) : undefined,
          q
            ? or(
                ilike(license.buyerEmail, `%${q}%`),
                ilike(license.keyLast5, `%${q}%`),
                ilike(tenant.name, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(desc(license.createdAt))
      .limit(200),
  );
}

async function ownerOf(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const [owner] = await tx
      .select({ id: systemUser.id, email: systemUser.email, fullName: systemUser.fullName })
      .from(systemUser)
      .where(and(eq(systemUser.isOwner, true), isNull(systemUser.disabledAt)));
    const [active] = await tx
      .select({ n: count() })
      .from(systemUser)
      .where(isNull(systemUser.disabledAt));
    return { owner: owner ?? null, activeUsers: active!.n };
  });
}

export async function listTenants() {
  const rows = await withPlatform((tx) =>
    tx
      .select({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        createdAt: tenant.createdAt,
        tier: license.tier,
        licenseStatus: license.status,
        seatLimit: license.seatLimit,
      })
      .from(tenant)
      .leftJoin(license, eq(license.tenantId, tenant.id))
      .orderBy(desc(tenant.createdAt))
      .limit(100),
  );
  // Tenant data is only reachable one tenant at a time, by design.
  return Promise.all(
    rows.map(async (t) => {
      const o = await ownerOf(t.id);
      return { ...t, ownerEmail: o.owner?.email ?? null, activeUsers: o.activeUsers };
    }),
  );
}

export async function getTenantDetail(tenantId: string) {
  const [t] = await withPlatform((tx) =>
    tx
      .select({
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        timeZone: tenant.timeZone,
        currency: tenant.currency,
        createdAt: tenant.createdAt,
        licenseId: license.id,
        keyLast5: license.keyLast5,
        tier: license.tier,
        licenseStatus: license.status,
        seatLimit: license.seatLimit,
      })
      .from(tenant)
      .leftJoin(license, eq(license.tenantId, tenant.id))
      .where(eq(tenant.id, tenantId)),
  );
  if (!t) return null;
  const o = await ownerOf(tenantId);
  return { ...t, owner: o.owner, activeUsers: o.activeUsers };
}

export async function listAdminAudit(limit = 200) {
  return withPlatform((tx) =>
    tx
      .select({
        id: adminAuditLog.id,
        at: adminAuditLog.createdAt,
        action: adminAuditLog.action,
        targetType: adminAuditLog.targetType,
        targetId: adminAuditLog.targetId,
        reason: adminAuditLog.reason,
        ip: adminAuditLog.ip,
        adminEmail: platformAdmin.email,
      })
      .from(adminAuditLog)
      .leftJoin(platformAdmin, eq(adminAuditLog.adminId, platformAdmin.id))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(limit),
  );
}

// ─────────────────────────── licenses ───────────────────────────

export async function mintLicenseAsAdmin(
  ctx: AdminCtx,
  input: { tier?: unknown; buyerEmail?: unknown; seatLimit?: unknown; reason?: unknown },
): Promise<OpResult<{ key: string; last5: string }>> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  if (!isTier(input.tier)) return fail("Choose a tier.");
  const email = input.buyerEmail ? emailField.safeParse(input.buyerEmail) : null;
  if (email && !email.success) return fail("Enter a valid buyer email, or leave it blank.");
  const seats = input.seatLimit ? Number(input.seatLimit) : undefined;
  if (seats !== undefined && (!Number.isInteger(seats) || seats < 1 || seats > 100_000)) {
    return fail("Seat limit must be a whole number between 1 and 100000.");
  }
  // Over 100 users is a custom quote: only an admin can set a seat limit above the tier's.
  const minted = await withPlatform(async (tx) => {
    const m = await mintLicense(
      { tier: input.tier as Tier, buyerEmail: email?.data, seatLimit: seats },
      tx,
    );
    await writeAdminAudit(
      {
        adminId: ctx.adminId,
        action: "license.mint",
        targetType: "license",
        targetId: m.licenseId,
        reason: reason.reason,
        ip: ctx.ip,
      },
      tx,
    );
    return m;
  });
  return { ok: true, key: minted.key, last5: minted.last5 };
}

type StatusAction = "suspend" | "revoke" | "reinstate";

export async function setLicenseStatus(
  ctx: AdminCtx,
  input: { licenseId?: unknown; action?: unknown; reason?: unknown },
): Promise<OpResult<{ status: string }>> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const action = input.action as StatusAction;
  if (!["suspend", "revoke", "reinstate"].includes(action)) return fail("Unknown action.");
  const id = z.string().uuid().safeParse(input.licenseId);
  if (!id.success) return fail("Unknown license.");

  return withPlatform(async (tx) => {
    const [lic] = await tx.select().from(license).where(eq(license.id, id.data)).for("update");
    if (!lic) return fail("Unknown license.");
    let next: "issued" | "active" | "suspended" | "revoked";
    if (action === "suspend") {
      if (lic.status !== "issued" && lic.status !== "active")
        return fail("Only an issued or active license can be suspended.");
      next = "suspended";
    } else if (action === "revoke") {
      if (lic.status === "revoked") return fail("This license is already revoked.");
      next = "revoked";
    } else {
      if (lic.status !== "suspended" && lic.status !== "revoked")
        return fail("Only a suspended or revoked license can be reinstated.");
      next = lic.tenantId ? "active" : "issued";
    }
    await tx.update(license).set({ status: next }).where(eq(license.id, lic.id));
    await writeAdminAudit(
      {
        adminId: ctx.adminId,
        action: `license.${action}`,
        targetType: "license",
        targetId: lic.id,
        reason: reason.reason,
        ip: ctx.ip,
      },
      tx,
    );
    // Sessions need no cleanup: every request re-checks the license, so suspended/revoked
    // licenses sign the whole tenant out on its next request.
    return { ok: true as const, status: next };
  });
}

/** Moves a license to another tier or custom seat count (e.g. a comped upgrade). */
export async function updateLicenseTier(
  ctx: AdminCtx,
  input: { licenseId?: unknown; tier?: unknown; seatLimit?: unknown; reason?: unknown },
): Promise<OpResult<{ tier: string; seatLimit: number }>> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const id = z.string().uuid().safeParse(input.licenseId);
  if (!id.success) return fail("Unknown license.");
  if (!isTier(input.tier)) return fail("Choose a tier.");
  const seats = input.seatLimit ? Number(input.seatLimit) : TIERS[input.tier].seatLimit;
  if (!Number.isInteger(seats) || seats < 1 || seats > 100_000)
    return fail("Enter a valid seat limit.");

  return withPlatform(async (tx) => {
    const [lic] = await tx.select().from(license).where(eq(license.id, id.data)).for("update");
    if (!lic) return fail("Unknown license.");
    if (lic.tenantId) {
      await setTenant(tx, lic.tenantId);
      const [active] = await tx
        .select({ n: count() })
        .from(systemUser)
        .where(isNull(systemUser.disabledAt));
      if (active!.n > seats) {
        return fail(
          `${active!.n} users are active, so the limit can't go below that. Disable users first.`,
        );
      }
    }
    await tx
      .update(license)
      .set({ tier: input.tier as Tier, seatLimit: seats })
      .where(eq(license.id, lic.id));
    await writeAdminAudit(
      {
        adminId: ctx.adminId,
        action: "license.update_tier",
        targetType: "license",
        targetId: lic.id,
        reason: `${reason.reason} [${lic.tier}/${lic.seatLimit} -> ${input.tier}/${seats}]`,
        ip: ctx.ip,
      },
      tx,
    );
    return { ok: true as const, tier: input.tier as string, seatLimit: seats };
  });
}

// ─────────────────────── owner recovery actions ───────────────────────
// "Housed for reset" means the platform keeps the owner's identity and can act on it. It never
// holds a readable password. Each action needs a reason, writes an audit row, and revokes the
// owner's existing sessions.

async function lockOwner(tx: Tx, tenantId: string) {
  await setTenant(tx, tenantId);
  const [owner] = await tx
    .select()
    .from(systemUser)
    .where(and(eq(systemUser.isOwner, true), isNull(systemUser.disabledAt)))
    .for("update");
  return owner;
}

const revokeSessions = (tx: Tx, userId: string) =>
  tx.delete(session).where(eq(session.userId, userId));

const tenantIdSchema = z.string().uuid();

/** Default: emails the owner a single-use reset link at the address on file. */
export async function sendOwnerResetLink(
  ctx: AdminCtx,
  input: { tenantId?: unknown; reason?: unknown },
  deps: { send?: typeof sendEmail } = {},
): Promise<OpResult> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const tid = tenantIdSchema.safeParse(input.tenantId);
  if (!tid.success) return fail("Unknown business.");
  try {
    return await withPlatform(async (tx): Promise<OpResult> => {
      const owner = await lockOwner(tx, tid.data);
      if (!owner) return fail("This business has no active owner. Use Re-activate instead.");
      const token = newToken();
      await tx
        .update(passwordResetToken)
        .set({ usedAt: new Date() })
        .where(and(eq(passwordResetToken.userId, owner.id), isNull(passwordResetToken.usedAt)));
      await tx.insert(passwordResetToken).values({
        tenantId: tid.data,
        userId: owner.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        issuedBy: "admin",
      });
      try {
        await (deps.send ?? sendEmail)(
          passwordResetEmail({ to: owner.email, token, appUrl: process.env.APP_URL ?? "" }),
        );
      } catch (err) {
        console.error("admin reset email failed:", err instanceof Error ? err.message : err);
        throw new Abort("We couldn't send the email. Nothing was changed.");
      }
      await revokeSessions(tx, owner.id);
      await writeAdminAudit(
        {
          adminId: ctx.adminId,
          action: "owner.send_reset_link",
          targetType: "tenant",
          targetId: tid.data,
          reason: reason.reason,
          ip: ctx.ip,
        },
        tx,
      );
      return { ok: true };
    });
  } catch (err) {
    if (err instanceof Abort) return fail(err.message);
    throw err;
  }
}

/** Groups of Crockford base32, 80 bits: easy to read out over the phone, no look-alikes. */
function temporaryPassword(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => KEY_ALPHABET[b & 31]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

/**
 * For owners who've lost access to their email: sets a temporary password, shown to the admin
 * exactly once (it is returned here and never stored or logged) and forces a change at the next
 * sign-in.
 */
export async function issueOwnerTemporaryPassword(
  ctx: AdminCtx,
  input: { tenantId?: unknown; reason?: unknown },
): Promise<OpResult<{ temporaryPassword: string; ownerEmail: string }>> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const tid = tenantIdSchema.safeParse(input.tenantId);
  if (!tid.success) return fail("Unknown business.");
  const temp = temporaryPassword();
  const hash = await hashPassword(temp);
  return withPlatform(async (tx) => {
    const owner = await lockOwner(tx, tid.data);
    if (!owner) return fail("This business has no active owner. Use Re-activate instead.");
    await tx
      .update(systemUser)
      .set({ passwordHash: hash, mustChangePassword: true, modifiedAt: new Date() })
      .where(eq(systemUser.id, owner.id));
    await revokeSessions(tx, owner.id);
    await writeAdminAudit(
      {
        adminId: ctx.adminId,
        action: "owner.temp_password",
        targetType: "tenant",
        targetId: tid.data,
        reason: reason.reason,
        ip: ctx.ip,
      },
      tx,
    );
    return { ok: true as const, temporaryPassword: temp, ownerEmail: owner.email };
  });
}

/** For when the owner left the company. Both the old and the new address are notified. */
export async function changeOwnerEmail(
  ctx: AdminCtx,
  input: { tenantId?: unknown; newEmail?: unknown; reason?: unknown },
  deps: { send?: typeof sendEmail } = {},
): Promise<OpResult<{ newEmail: string }>> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const tid = tenantIdSchema.safeParse(input.tenantId);
  if (!tid.success) return fail("Unknown business.");
  const parsed = emailField.safeParse(input.newEmail);
  if (!parsed.success) return fail("Enter a valid new email address.");
  const newEmail = parsed.data;
  const send = deps.send ?? sendEmail;

  try {
    return await withPlatform(async (tx): Promise<OpResult<{ newEmail: string }>> => {
      const owner = await lockOwner(tx, tid.data);
      if (!owner) return fail("This business has no active owner. Use Re-activate instead.");
      if (owner.email.toLowerCase() === newEmail) return fail("That is already the owner's email.");
      const taken = await tx.execute(sql`select 1 from auth_find_user_by_email(${newEmail})`);
      if (taken.rows.length > 0) return fail("That email address already has an account.");

      await tx
        .update(systemUser)
        .set({ email: newEmail, emailVerifiedAt: null, modifiedAt: new Date() })
        .where(eq(systemUser.id, owner.id));
      await revokeSessions(tx, owner.id);
      try {
        await send({
          to: owner.email,
          subject: "The owner email for your account was changed",
          text: `A platform administrator changed the owner email for your business from ${owner.email} to ${newEmail}. If this wasn't expected, contact support.`,
        });
        await send({
          to: newEmail,
          subject: "You are now the owner contact for your account",
          text: `A platform administrator set ${newEmail} as the owner email for your business. Use "Forgot your password?" on the sign-in page to choose a password.`,
        });
      } catch (err) {
        console.error(
          "owner email change notification failed:",
          err instanceof Error ? err.message : err,
        );
        throw new Abort("We couldn't send the notification emails. Nothing was changed.");
      }
      await writeAdminAudit(
        {
          adminId: ctx.adminId,
          action: "owner.change_email",
          targetType: "tenant",
          targetId: tid.data,
          reason: `${reason.reason} [${owner.email} -> ${newEmail}]`,
          ip: ctx.ip,
        },
        tx,
      );
      return { ok: true, newEmail };
    });
  } catch (err) {
    if (err instanceof Abort) return fail(err.message);
    throw err;
  }
}

/**
 * Last resort: returns the license to a claimable state so the business can create a new owner
 * on the normal activation screen. Tenant data is preserved. The previous owner is disabled and
 * their address freed (renamed) so it can be reused; everyone in the business is signed out until
 * the key is activated again.
 */
export async function reactivateLicense(
  ctx: AdminCtx,
  input: { tenantId?: unknown; reason?: unknown },
): Promise<OpResult> {
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  const tid = tenantIdSchema.safeParse(input.tenantId);
  if (!tid.success) return fail("Unknown business.");

  return withPlatform(async (tx): Promise<OpResult> => {
    const [lic] = await tx
      .select()
      .from(license)
      .where(eq(license.tenantId, tid.data))
      .for("update");
    if (!lic) return fail("This business has no license.");
    if (lic.status !== "active") return fail("Only an active license can be re-activated.");

    const owner = await lockOwner(tx, tid.data);
    if (owner) {
      const [local = "", domain = ""] = owner.email.split("@");
      await tx
        .update(systemUser)
        .set({
          isOwner: false,
          disabledAt: new Date(),
          email: `${local}+former-${owner.id.slice(0, 8)}@${domain}`,
          modifiedAt: new Date(),
        })
        .where(eq(systemUser.id, owner.id));
    }
    // Sign out everyone in this business: the license is about to stop being active anyway.
    const users = await tx.select({ id: systemUser.id }).from(systemUser);
    if (users.length > 0) {
      await tx.delete(session).where(
        inArray(
          session.userId,
          users.map((u) => u.id),
        ),
      );
    }
    await tx.update(license).set({ status: "issued" }).where(eq(license.id, lic.id));
    await writeAdminAudit(
      {
        adminId: ctx.adminId,
        action: "license.reactivate",
        targetType: "tenant",
        targetId: tid.data,
        reason: reason.reason,
        ip: ctx.ip,
      },
      tx,
    );
    return { ok: true };
  });
}
