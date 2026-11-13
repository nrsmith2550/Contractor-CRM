import { formatDateTime } from "@/lib/format";
import type { Activity, TimelineItem } from "@/server/domain/activities";
import { DoneButton } from "./DoneButton";

const KIND: Record<string, string> = {
  task: "Task",
  phone_call: "Phone call",
  email: "Email",
  appointment: "Appointment",
};

function ActivityLine({ a, tz, now }: { a: Activity; tz: string; now: number }) {
  const open = a.status === "open";
  const doneable = open && (a.activityType === "task" || a.activityType === "phone_call");
  const overdue = open && a.dueAt && a.dueAt.getTime() < now;
  return (
    <>
      <strong>{KIND[a.activityType] ?? a.activityType.replace(/_/g, " ")}</strong>
      {a.activityType === "phone_call" && a.direction && (
        <> · {a.direction === "incoming" ? "they called" : "you called"}</>
      )}
      {" · "}
      <time>{formatDateTime(a.createdAt, tz)}</time>
      {a.status !== "open" && <span className="crm-pill crm-pill-done">{a.status}</span>}
      {overdue && <span className="crm-pill crm-pill-late">Overdue</span>}
      <p>{a.subject}</p>
      {a.description && <p style={{ whiteSpace: "pre-wrap" }}>{a.description}</p>}
      {a.dueAt && open && (
        <p className="crm-muted">
          Due <time>{formatDateTime(a.dueAt, tz)}</time>
        </p>
      )}
      {doneable && <DoneButton id={a.id} label={a.subject} />}
    </>
  );
}

export function Timeline({ items, tz }: { items: TimelineItem[]; tz: string }) {
  if (items.length === 0)
    return <p>Nothing here yet. Add a note, log a call or add a task to start the timeline.</p>;
  const now = Date.now();
  return (
    <ul className="crm-timeline" aria-label="Timeline">
      {items.map((it) =>
        it.kind === "note" ? (
          <li key={it.note.id}>
            <strong>Note</strong> · <time>{formatDateTime(it.at, tz)}</time>
            <p style={{ whiteSpace: "pre-wrap" }}>{it.note.body}</p>
          </li>
        ) : (
          <li key={it.activity.id}>
            <ActivityLine a={it.activity} tz={tz} now={now} />
          </li>
        ),
      )}
    </ul>
  );
}
