import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { withPlatform, withTenant } from "@/db/client";
import { license, securityRole } from "@/db/schema";
import { requireUser } from "@/server/auth/http";
import { listPendingInvitations, listUsers } from "@/server/auth/invitations";
import { revokeInvitationAction } from "@/server/actions/users";
import { can } from "@/server/security/roles";
import { loadSubject } from "@/server/security/subject";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const user = await requireUser();
  const subject = await loadSubject(user.tenantId, user.userId);
  if (!can(subject, "user", "read")) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Users</h1>
        <p>You don&apos;t have permission to view this page.</p>
      </main>
    );
  }

  const [users, pending, roles, [lic]] = await Promise.all([
    listUsers(user.tenantId),
    listPendingInvitations(user.tenantId),
    withTenant(user.tenantId, (tx) =>
      tx.select({ id: securityRole.id, name: securityRole.name }).from(securityRole),
    ),
    withPlatform((tx) =>
      tx
        .select({ seatLimit: license.seatLimit, tier: license.tier })
        .from(license)
        .where(eq(license.tenantId, user.tenantId)),
    ),
  ]);
  const active = users.filter((u) => !u.disabledAt).length;
  const canInvite = can(subject, "user", "create");
  const canRevoke = can(subject, "user", "write");

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1>Users</h1>
      <p>
        <strong>
          {active} of {lic?.seatLimit ?? 0}
        </strong>{" "}
        seats in use ({lic?.tier} license).
        {pending.length > 0 ? ` ${pending.length} pending invitation(s) also hold a seat.` : ""}
      </p>

      <table>
        <thead>
          <tr>
            <th align="left">Name</th>
            <th align="left">Email</th>
            <th align="left">Role</th>
            <th align="left">Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={`${u.id}-${u.roleName}`}>
              <td>
                {u.fullName}
                {u.isOwner ? " (owner)" : ""}
              </td>
              <td>{u.email}</td>
              <td>{u.roleName ?? "—"}</td>
              <td>{u.disabledAt ? "Disabled" : "Active"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pending.length > 0 ? (
        <>
          <h2>Pending invitations</h2>
          <ul>
            {pending.map((p) => (
              <li key={p.id}>
                {p.email} — {p.roleName ?? "no role"}, expires{" "}
                {p.expiresAt.toISOString().slice(0, 10)}
                {canRevoke ? (
                  <form
                    action={revokeInvitationAction}
                    style={{ display: "inline", marginLeft: 8 }}
                  >
                    <input type="hidden" name="invitationId" value={p.id} />
                    <button type="submit">Revoke</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {canInvite ? (
        <>
          <h2>Invite a user</h2>
          <InviteForm roles={roles} />
        </>
      ) : null}
    </main>
  );
}
