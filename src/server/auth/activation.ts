import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { setTenant, withPlatform } from "@/db/client";
import {
  auditLog,
  authEvent,
  license,
  securityRole,
  sequence,
  systemUser,
  tenant,
  userRole,
} from "@/db/schema";
import { activateFields, passwordsMatch } from "@/lib/validation/auth";
import { DEFAULT_ROLES, OWNER_ROLE_NAME } from "@/server/security/roles";
import {
  hashLicenseKey,
  isValidLicenseKey,
  licenseKeyLast5,
  normalizeLicenseKey,
} from "./license-key";
import { hashPassword, validatePassword } from "./password";
import { ACTIVATE_LIMIT, hitRateLimit } from "./rate-limit";

// Same field rules as the browser form (src/lib/validation/auth.ts), plus the caller's IP.
export const ActivationInput = activateFields
  .extend({ ip: z.string().max(64).default("unknown") })
  .refine(passwordsMatch, { message: "Passwords do not match", path: ["confirmPassword"] });

export type ActivationResult =
  | { ok: true; tenantId: string; userId: string }
  | {
      ok: false;
      code:
        | "invalid_input"
        | "rate_limited"
        | "invalid_key"
        | "already_active"
        | "unavailable"
        | "weak_password"
        | "email_taken";
      message: string;
      /** Only for already_active: a masked hint of the owner's email, e.g. j***@acme.com. */
      emailHint?: string;
    };

/** Entities that get an auto-numbering sequence at activation (LEAD-01001 etc.). */
const SEQUENCES: [entity: string, prefix: string][] = [
  ["lead", "LEAD"],
  ["account", "ACC"],
  ["contact", "CON"],
  ["opportunity", "OPP"],
  ["quote", "QUO"],
  ["order", "ORD"],
  ["case", "CAS"],
  ["work_order", "WO"],
];

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "tenant"}-${randomBytes(3).toString("hex")}`;
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Security-event log. Never put keys, passwords or tokens in `detail`. */
export async function logAuthEvent(kind: string, ip: string, detail?: string): Promise<void> {
  await withPlatform((tx) => tx.insert(authEvent).values({ kind, ip, detail }));
}

class EmailTaken extends Error {}

const fail = (
  code: Extract<ActivationResult, { ok: false }>["code"],
  message: string,
  extra: { emailHint?: string } = {},
): ActivationResult => ({ ok: false, code, message, ...extra });

/**
 * First sign-in: turns an `issued` license key into a tenant plus its owner account, in one
 * transaction. A key activates exactly once; later attempts get `already_active`.
 */
export async function activateLicense(raw: unknown): Promise<ActivationResult> {
  const parsed = ActivationInput.safeParse(raw);
  if (!parsed.success) {
    return fail(
      "invalid_input",
      parsed.error.issues[0]?.message ?? "Check the form and try again.",
    );
  }
  const input = parsed.data;
  const normalized = normalizeLicenseKey(input.licenseKey);

  // Every attempt counts, per IP and per key prefix, before any other work.
  const byIp = await hitRateLimit(`activate:ip:${input.ip}`, ACTIVATE_LIMIT);
  const byKey = await hitRateLimit(
    `activate:key:${normalized ? normalized.slice(0, 5) : "malformed"}`,
    ACTIVATE_LIMIT,
  );
  if (!byIp.allowed || !byKey.allowed) {
    await logAuthEvent("activate_rate_limited", input.ip);
    return fail("rate_limited", "Too many attempts. Try again in 15 minutes.");
  }

  if (!normalized || !isValidLicenseKey(input.licenseKey)) {
    await logAuthEvent("activate_invalid_key", input.ip, "malformed or bad checksum");
    return fail("invalid_key", "That license key isn't valid. Check it and try again.");
  }

  const pw = validatePassword(input.password, [
    input.ownerEmail.split("@")[0] ?? "",
    input.ownerName,
    input.companyName,
  ]);
  if (!pw.ok) return fail("weak_password", pw.reason);

  const passwordHash = await hashPassword(input.password);
  const keyHash = hashLicenseKey(normalized);

  try {
    return await withPlatform(async (tx): Promise<ActivationResult> => {
      const [lic] = await tx
        .select()
        .from(license)
        .where(eq(license.keyHash, keyHash))
        .for("update");
      if (!lic) {
        await tx.insert(authEvent).values({ kind: "activate_unknown_key", ip: input.ip });
        return fail("invalid_key", "That license key isn't valid. Check it and try again.");
      }
      if (lic.status === "active" && lic.tenantId) {
        await setTenant(tx, lic.tenantId);
        const [owner] = await tx
          .select({ email: systemUser.email })
          .from(systemUser)
          .where(eq(systemUser.isOwner, true))
          .limit(1);
        return fail("already_active", "This key has already been activated. Sign in instead.", {
          emailHint: owner ? maskEmail(owner.email) : undefined,
        });
      }
      if (lic.status !== "issued") {
        return fail("unavailable", "This license can't be used. Contact support.");
      }

      // A claimable license that is still bound to a tenant was re-activated by a platform admin:
      // the business keeps its data and only gets a new owner. Otherwise create a new business.
      const reclaim = lic.tenantId !== null;
      let tenantId: string;
      if (reclaim) {
        tenantId = lic.tenantId!;
      } else {
        const [t] = await tx
          .insert(tenant)
          .values({
            name: input.companyName,
            slug: slugify(input.companyName),
            timeZone: input.timeZone,
            currency: input.currency,
          })
          .returning({ id: tenant.id });
        tenantId = t!.id;
      }
      await setTenant(tx, tenantId);

      let user: { id: string };
      try {
        [user] = (await tx
          .insert(systemUser)
          .values({
            tenantId,
            email: input.ownerEmail,
            fullName: input.ownerName,
            passwordHash,
            isOwner: true,
          })
          .returning({ id: systemUser.id })) as [{ id: string }];
      } catch (err) {
        if (isUniqueViolation(err)) throw new EmailTaken();
        throw err;
      }

      let adminRoleId: string;
      if (reclaim) {
        // Roles and numbering sequences already exist and are kept as they are.
        const [existing] = await tx
          .select({ id: securityRole.id })
          .from(securityRole)
          .where(eq(securityRole.name, OWNER_ROLE_NAME));
        adminRoleId = existing!.id;
      } else {
        const roles = await tx
          .insert(securityRole)
          .values(DEFAULT_ROLES.map((r) => ({ tenantId, name: r.name, privileges: r.privileges })))
          .returning({ id: securityRole.id, name: securityRole.name });
        adminRoleId = roles.find((r) => r.name === OWNER_ROLE_NAME)!.id;
        await tx
          .insert(sequence)
          .values(SEQUENCES.map(([entity, prefix]) => ({ tenantId, entity, prefix })));
      }
      await tx.insert(userRole).values({ tenantId, userId: user.id, roleId: adminRoleId });

      await tx
        .update(license)
        .set({ status: "active", tenantId, activatedAt: lic.activatedAt ?? new Date() })
        .where(eq(license.id, lic.id));

      await tx.insert(auditLog).values({
        tenantId,
        entity: "license",
        recordId: lic.id,
        action: reclaim ? "reactivate" : "activate",
        changes: { keyLast5: licenseKeyLast5(normalized), tier: lic.tier },
        userId: user.id,
      });

      return { ok: true, tenantId, userId: user.id };
    });
  } catch (err) {
    if (err instanceof EmailTaken) {
      await logAuthEvent("activate_email_taken", input.ip);
      return fail("email_taken", "An account with that email already exists. Sign in instead.");
    }
    throw err;
  }
}
