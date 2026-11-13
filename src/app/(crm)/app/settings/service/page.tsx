import { InlineForm } from "@/components/form/InlineForm";
import { createSkillAction } from "@/server/actions/bookings";
import { createQueueAction, createSubjectAction } from "@/server/actions/service";
import { listCharacteristics } from "@/server/domain/resources";
import { requireUser } from "@/server/auth/http";
import { listQueues, listSubjects } from "@/server/domain/cases";
import { buildCtx } from "@/server/domain/context";

export default async function ServiceSettingsPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const [subjects, queues, skills] = await Promise.all([
    listSubjects(ctx),
    listQueues(ctx),
    listCharacteristics(ctx),
  ]);
  return (
    <>
      <h1>Service settings</h1>
      <h2>Subjects</h2>
      <p>Categories for support requests, such as Heating or Billing.</p>
      {subjects.ok && subjects.rows.length === 0 && <p>No subjects yet.</p>}
      {subjects.ok && (
        <ul aria-label="Subjects">
          {subjects.rows.map((s) => (
            <li key={s.id}>{s.name}</li>
          ))}
        </ul>
      )}
      <InlineForm
        submitLabel="Add subject"
        action={createSubjectAction}
        fields={[{ name: "name", label: "Subject name" }]}
      />
      <h2>Queues</h2>
      <p>Work queues support requests can be routed to, such as Support or Dispatch.</p>
      {queues.ok && queues.rows.length === 0 && <p>No queues yet.</p>}
      {queues.ok && (
        <ul aria-label="Queues">
          {queues.rows.map((q) => (
            <li key={q.id}>{q.name}</li>
          ))}
        </ul>
      )}
      <InlineForm
        submitLabel="Add queue"
        action={createQueueAction}
        fields={[{ name: "name", label: "Queue name" }]}
      />
      <h2>Skills</h2>
      <p>Skills team members have and jobs can require, such as HVAC certified.</p>
      {skills.ok && skills.rows.length === 0 && <p>No skills yet.</p>}
      {skills.ok && (
        <ul aria-label="Skills">
          {skills.rows.map((x) => (
            <li key={x.id}>{x.name}</li>
          ))}
        </ul>
      )}
      <InlineForm
        submitLabel="Add skill"
        action={createSkillAction}
        fields={[{ name: "name", label: "Skill name" }]}
      />
    </>
  );
}
