import Link from "next/link";
import { ResourceEditor } from "@/components/form/ResourceEditor";
import { createResourceAction } from "@/server/actions/bookings";
import { requireUser } from "@/server/auth/http";
import { listUsers } from "@/server/auth/invitations";
import { buildCtx } from "@/server/domain/context";
import { listCharacteristics } from "@/server/domain/resources";
import { listResources } from "@/server/domain/resources";
import { defaultWorkHours } from "@/server/domain/work-hours";
import { can } from "@/server/security/roles";

export const metadata = { title: "Resources" };

export default async function ResourcesPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const [resources, skills, users] = await Promise.all([
    listResources(ctx),
    listCharacteristics(ctx),
    listUsers(user.tenantId),
  ]);
  if (!resources.ok) {
    return (
      <>
        <h1>Resources</h1>
        <div role="alert" className="crm-error">
          {resources.message}
        </div>
      </>
    );
  }
  const skillName = new Map(skills.ok ? skills.rows.map((s) => [s.id, s.name]) : []);
  const userName = new Map(users.map((u) => [u.id, u.fullName]));
  const canEdit = can(ctx.subject, "security_role", "write");
  return (
    <>
      <h1>Resources</h1>
      <p>People, crews and equipment that can be booked onto work orders.</p>
      <table className="crm-grid">
        <caption className="crm-sr">Resources</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Sign-in</th>
            <th scope="col">Skills</th>
          </tr>
        </thead>
        <tbody>
          {resources.rows.length === 0 && (
            <tr>
              <td colSpan={4}>No resources yet.</td>
            </tr>
          )}
          {resources.rows.map((r) => (
            <tr key={r.id}>
              <td>{canEdit ? <Link href={`/app/resources/${r.id}`}>{r.name}</Link> : r.name}</td>
              <td>{r.resourceType}</td>
              <td>{r.userId ? (userName.get(r.userId) ?? "") : ""}</td>
              <td>
                {r.skillIds
                  .map((id) => skillName.get(id))
                  .filter(Boolean)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit && (
        <>
          <h2>Add a resource</h2>
          <ResourceEditor
            init={{
              name: "",
              resourceType: "user",
              userId: "",
              color: "#3366cc",
              workHours: defaultWorkHours(),
              skillIds: [],
            }}
            users={users
              .filter((u) => !u.disabledAt)
              .map((u) => ({ id: u.id, label: `${u.fullName} (${u.email})` }))}
            skills={skills.ok ? skills.rows : []}
            action={createResourceAction}
            submitLabel="Add resource"
            resetOnSuccess
          />
        </>
      )}
    </>
  );
}
