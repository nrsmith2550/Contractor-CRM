import { formatDateTime } from "@/lib/format";
import type { TimelineItem } from "@/server/domain/activities";

export function Timeline({ items, tz }: { items: TimelineItem[]; tz: string }) {
  if (items.length === 0) return <p>No activity yet. Add a note to start the timeline.</p>;
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
            <strong>{it.activity.activityType.replace(/_/g, " ")}</strong> ·{" "}
            <time>{formatDateTime(it.at, tz)}</time>
            <p>{it.activity.subject}</p>
          </li>
        ),
      )}
    </ul>
  );
}
