import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { withPlatform, withTenant, type Tx } from "@/db/client";
import {
  auditLog,
  invitation,
  license,
  securityRole,
  systemUser,
  tenant,
  userRole,
} from "@/db/schema";
import { acceptInviteSchema, inviteUserSchema } from "@/lib/validation/auth";
import { sendEmail } from "@/server/email/mailer";
import { invitationEmail } from "@/server/email/templates";
import { hashPassword, validatePassword } from "./password";
import { hitRateLimit } from "./rate-limit";
import { hashToken, newToken } from "./tokens";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ACCEPT_LIMIT = { max: 10, windowSeconds: 15 * 60 } as const;

type Deps = { send?: typeof sendEmail; appUrl?: string };

class Abort extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    if ((e as { code?: string }).code === "23505") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** Active (not disabled) users and still-pending invitations, against the license's seat limit. */
async function seatUsage(tx: Tx, tenantId: string, excludeEmail?: string) {
  const [lic] = await tx
    .select({ seatLimit: license.seatLimit })
    .from(license)
    .where(eq(license.tenantId, tenantId));
  const [active] = await tx
    .select({ n: count() })
    .from(systemUser)
    .where(isNull(systemUser.disabledAt));
  const pendingWhere = and(isNull(invitation.acceptedAt), gt(invitation.expiresAt, sql`now()`));
  const [pending] = await tx
    .select({ n: count() })
    .from(invitation)
    .where(
      excludeEmail
        ? and(pendingWhere, sql`lower(${invitation.email}) <> ${excludeEmail}`)
        : pendingWhere,
    );
  return { seatLimit: lic?.seatLimit ?? 0, active: active!.n, pending: pending!.n };
}

export type InviteResult =
  | { ok: true; invitationId: string }
  | {
      ok: false;
      code: "invalid_input" | "invalid_role" | "unavailable" | "seat_limit" | "email_failed";
      message: string;
    };

/**
 * Invites someone to the inviter's business. The caller must already have checked `can()`.
 * Seats: active users + pending invitations may not exceed the license's seat limit, so the
 * "Upgrade your license" prompt appears at invite time, not after the invitee has set up.
 * The link is emailed before commit; if sending fails nothing is stored.
 */
export async function inviteUser(
  args: { tenantId: string; inviterId: string; email: unknown; roleId: unknown },
  deps: Deps = {},
): Promise<InviteResult> {
  const parsed = inviteUserSchema.safeParse({ email: args.email, roleId: args.roleId });
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }
  const { email, roleId } = parsed.data;
  const token = newToken();

  try {
    return await withTenant(args.tenantId, async (tx): Promise<InviteResult> => {
      const [role] = await tx
        .select({ id: securityRole.id })
        .from(securityRole)
        .where(eq(securityRole.id, roleId));
      if (!role) return { ok: false, code: "invalid_role", message: "Choose a valid role." };

      // Accounts are unique platform-wide; the same wording whether the address is in this
      // business or another, so an inviter learns nothing about other businesses.
      const existing = await tx.execute(sql`select 1 from auth_find_user_by_email(${email})`);
      if (existing.rows.length > 0) {
        return { ok: false, code: "unavailable", message: "That email address can't be invited." };
      }

      const u = await seatUsage(tx, args.tenantId, email);
      if (u.active + u.pending >= u.seatLimit) {
        return {
          ok: false,
          code: "seat_limit",
          message: `Your license allows ${u.seatLimit} active users. Upgrade your license to add more.`,
        };
      }

      // A newer invitation to the same address replaces the older one.
      await tx
        .delete(invitation)
        .where(and(isNull(invitation.acceptedAt), sql`lower(${invitation.email}) = ${email}`));
      const [inv] = await tx
        .insert(invitation)
        .values({
          tenantId: args.tenantId,
          email,
          roleId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedBy: args.inviterId,
        })
        .returning({ id: invitation.id });

      const [inviter] = await tx
        .select({ fullName: systemUser.fullName })
        .from(systemUser)
        .where(eq(systemUser.id, args.inviterId));
      const [t] = await tx
        .select({ name: tenant.name })
        .from(tenant)
        .where(eq(tenant.id, args.tenantId));
      try {
        await (deps.send ?? sendEmail)(
          invitationEmail({
            to: email,
            token,
            appUrl: deps.appUrl ?? process.env.APP_URL ?? "",
            companyName: t?.name ?? "your team",
            inviterName: inviter?.fullName ?? "A colleague",
          }),
        );
      } catch (err) {
        console.error("invitation email failed:", err instanceof Error ? err.message : err);
        throw new Abort("email_failed");
      }

      await tx.insert(auditLog).values({
        tenantId: args.tenantId,
        entity: "invitation",
        recordId: inv!.id,
        action: "invite",
        changes: { roleId },
        userId: args.inviterId,
      });
      return { ok: true, invitationId: inv!.id };
    });
  } catch (err) {
    if (err instanceof Abort) {
      return {
        ok: false,
        code: "email_failed",
        message: "We couldn't send the invitation email. Try again.",
      };
    }
    throw err;
  }
}

export async function revokeInvitation(args: {
  tenantId: string;
  invitationId: string;
  actorId: string;
}): Promise<boolean> {
  return withTenant(args.tenantId, async (tx) => {
    const rows = await tx
      .delete(invitation)
      .where(and(eq(invitation.id, args.invitationId), isNull(invitation.acceptedAt)))
      .returning({ id: invitation.id });
    if (rows.length === 0) return false;
    await tx.insert(auditLog).values({
      tenantId: args.tenantId,
      entity: "invitation",
      recordId: args.invitationId,
      action: "revoke",
      userId: args.actorId,
    });
    return true;
  });
}

export async function listPendingInvitations(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: invitation.id,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        roleName: securityRole.name,
      })
      .from(invitation)
      .leftJoin(securityRole, eq(invitation.roleId, securityRole.id))
      .where(and(isNull(invitation.acceptedAt), gt(invitation.expiresAt, sql`now()`))),
  );
}

export async function listUsers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        id: systemUser.id,
        fullName: systemUser.fullName,
        email: systemUser.email,
        isOwner: systemUser.isOwner,
        disabledAt: systemUser.disabledAt,
        roleName: securityRole.name,
      })
      .from(systemUser)
      .leftJoin(userRole, eq(userRole.userId, systemUser.id))
      .leftJoin(securityRole, eq(userRole.roleId, securityRole.id)),
  );
}

type InviteRow = {
  invitation_id: string;
  tenant_id: string;
  email: string;
  role_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  tenant_name: string;
  seat_limit: number | null;
  license_status: string | null;
};

async function findInvitation(token: string): Promise<InviteRow | undefined> {
  const res = await withPlatform((tx) =>
    tx.execute<InviteRow>(sql`select * from auth_find_invitation(${hashToken(token)})`),
  );
  return res.rows[0];
}

const open = (row: InviteRow | undefined): row is InviteRow =>
  !!row && !row.accepted_at && new Date(row.expires_at).getTime() > Date.now();

/** For the accept page: who invited you and to which business, or null if the link is dead. */
export async function getInvitationPreview(
  token: string | undefined,
): Promise<{ email: string; companyName: string } | null> {
  if (!token) return null;
  const row = await findInvitation(token);
  return open(row) ? { email: row.email, companyName: row.tenant_name } : null;
}

export type AcceptResult =
  | { ok: true; tenantId: string; userId: string }
  | {
      ok: false;
      code:
        | "invalid_input"
        | "rate_limited"
        | "invalid_token"
        | "weak_password"
        | "license_inactive"
        | "seat_limit"
        | "unavailable";
      message: string;
    };

/**
 * Invitee sets a name and password. The link proves control of the address, so the account
 * starts email-verified. The invitation is consumed atomically and the seat limit is
 * re-checked inside the same transaction (it may have filled since the invite was sent).
 */
export async function acceptInvitation(args: {
  token: string;
  values: unknown;
  ip: string;
}): Promise<AcceptResult> {
  const limited = await hitRateLimit(`accept:ip:${args.ip}`, ACCEPT_LIMIT);
  if (!limited.allowed) {
    return { ok: false, code: "rate_limited", message: "Too many attempts. Try again later." };
  }
  const parsed = acceptInviteSchema.safeParse(args.values);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "Check the form.",
    };
  }
  const dead: AcceptResult = {
    ok: false,
    code: "invalid_token",
    message: "This invitation has expired or was already used. Ask for a new one.",
  };
  const row = await findInvitation(args.token);
  if (!open(row)) return dead;
  if (row.license_status !== "active") {
    return {
      ok: false,
      code: "license_inactive",
      message: "This license isn't active. Contact support.",
    };
  }
  const { fullName, password } = parsed.data;
  const policy = validatePassword(password, [row.email.split("@")[0] ?? "", fullName]);
  if (!policy.ok) return { ok: false, code: "weak_password", message: policy.reason };

  const passwordHash = await hashPassword(password);
  try {
    return await withTenant(row.tenant_id, async (tx): Promise<AcceptResult> => {
      const claimed = await tx
        .update(invitation)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitation.id, row.invitation_id),
            isNull(invitation.acceptedAt),
            sql`${invitation.expiresAt} > now()`,
          ),
        )
        .returning({ id: invitation.id });
      if (claimed.length === 0) return dead;

      const [active] = await tx
        .select({ n: count() })
        .from(systemUser)
        .where(isNull(systemUser.disabledAt));
      if (active!.n >= (row.seat_limit ?? 0)) throw new Abort("seat_limit");

      const [user] = await tx
        .insert(systemUser)
        .values({
          tenantId: row.tenant_id,
          email: row.email,
          fullName,
          passwordHash,
          emailVerifiedAt: new Date(),
        })
        .returning({ id: systemUser.id });
      if (row.role_id) {
        const [role] = await tx
          .select({ id: securityRole.id })
          .from(securityRole)
          .where(eq(securityRole.id, row.role_id));
        if (role) {
          await tx
            .insert(userRole)
            .values({ tenantId: row.tenant_id, userId: user!.id, roleId: role.id });
        }
      }
      await tx.insert(auditLog).values({
        tenantId: row.tenant_id,
        entity: "invitation",
        recordId: row.invitation_id,
        action: "accept",
        userId: user!.id,
      });
      return { ok: true, tenantId: row.tenant_id, userId: user!.id };
    });
  } catch (err) {
    if (err instanceof Abort && err.code === "seat_limit") {
      return {
        ok: false,
        code: "seat_limit",
        message: "This business has no free seats. Ask the owner to upgrade the license.",
      };
    }
    if (isUniqueViolation(err)) {
      return {
        ok: false,
        code: "unavailable",
        message: "An account with this email already exists. Sign in instead.",
      };
    }
    throw err;
  }
}
