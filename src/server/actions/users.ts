"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/server/actions/auth";
import { requireUser } from "@/server/auth/http";
import { inviteUser, revokeInvitation } from "@/server/auth/invitations";
import { can } from "@/server/security/roles";
import { loadSubject } from "@/server/security/subject";

const DENIED: ActionResult = { ok: false, message: "You don't have permission to do that." };

/** Settings → Users → Invite. Auth → can() → domain, as the conventions require. */
export async function inviteUserAction(values: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const subject = await loadSubject(user.tenantId, user.userId);
  if (!can(subject, "user", "create")) return DENIED;

  const v =
    typeof values === "object" && values !== null ? (values as Record<string, unknown>) : {};
  const res = await inviteUser({
    tenantId: user.tenantId,
    inviterId: user.userId,
    email: v.email,
    roleId: v.roleId,
  });
  if (!res.ok) {
    return {
      ok: false,
      message: res.message,
      field: res.code === "invalid_role" ? "roleId" : "email",
    };
  }
  revalidatePath("/app/settings/users");
  return { ok: true };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const subject = await loadSubject(user.tenantId, user.userId);
  if (!can(subject, "user", "write")) return;
  const id = formData.get("invitationId");
  if (typeof id !== "string") return;
  await revokeInvitation({ tenantId: user.tenantId, invitationId: id, actorId: user.userId });
  revalidatePath("/app/settings/users");
}
