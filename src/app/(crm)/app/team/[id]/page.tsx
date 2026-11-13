import { notFound } from "next/navigation";
import { ResourceEditor } from "@/components/form/ResourceEditor";
import { updateResourceAction } from "@/server/actions/bookings";
import { requireUser } from "@/server/auth/http";
import { listUsers } from "@/server/auth/invitations";
import { buildCtx } from "@/server/domain/context";
import { getResource, listCharacteristics } from "@/server/domain/resources";
import { can } from "@/server/security/roles";

export default async function ResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const [res, skills, users] = await Promise.all([
    getResource(ctx, id),
    listCharacteristics(ctx),
    listUsers(user.tenantId),
  ]);
  if (!res.ok) notFound();
  const r = res.resource;
  return (
    <>
      <h1>{r.name}</h1>
      {can(ctx.subject, "security_role", "write") ? (
        <ResourceEditor
          init={{
            id: r.id,
            name: r.name,
            resourceType: r.resourceType,
            userId: r.userId ?? "",
            color: r.color ?? "#3366cc",
            workHours: r.workHours,
            skillIds: res.skillIds,
          }}
          users={users
            .filter((u) => !u.disabledAt)
            .map((u) => ({ id: u.id, label: `${u.fullName} (${u.email})` }))}
          skills={skills.ok ? skills.rows : []}
          action={updateResourceAction.bind(null, id)}
          submitLabel="Save"
        />
      ) : (
        <p>Only administrators can change team members.</p>
      )}
    </>
  );
}
