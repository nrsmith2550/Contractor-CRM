import Link from "next/link";
import { ScheduleBoard } from "@/components/schedule/ScheduleBoard";
import { BOARD_VIEWS, boardRange, isDate, localDate, shiftDate, type BoardView } from "@/lib/board";
import { requireUser } from "@/server/auth/http";
import { listBookings } from "@/server/domain/bookings";
import { buildCtx } from "@/server/domain/context";
import { listCharacteristics, listResources } from "@/server/domain/resources";
import { listWorkOrders } from "@/server/domain/work-orders";
import { tenantTimeZone } from "@/server/entities/tenant";
import { can } from "@/server/security/roles";

export const metadata = { title: "Schedule board" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; skill?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const tz = await tenantTimeZone(user.tenantId);

  const view: BoardView = BOARD_VIEWS.includes(sp.view as BoardView)
    ? (sp.view as BoardView)
    : "week";
  const today = localDate(new Date(), tz);
  const date = isDate(sp.date) ? sp.date : today;
  const range = boardRange(view, date, tz);

  const [resources, skills, bookings, unscheduled] = await Promise.all([
    listResources(ctx),
    listCharacteristics(ctx),
    listBookings(ctx, { from: range.start, to: range.end }),
    listWorkOrders(ctx, { view: "unscheduled", limit: 100 }),
  ]);
  if (!resources.ok || !bookings.ok) {
    return (
      <>
        <h1>Schedule board</h1>
        <div role="alert" className="crm-error">
          {resources.ok ? "You don't have access to bookings." : resources.message}
        </div>
      </>
    );
  }

  const skillId = skills.ok && skills.rows.some((s) => s.id === sp.skill) ? sp.skill : undefined;
  const shown = resources.rows.filter((r) => !skillId || r.skillIds.includes(skillId));
  const shownIds = new Set(shown.map((r) => r.id));
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ view, date, ...(skillId ? { skill: skillId } : {}) });
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) p.delete(k);
      else p.set(k, v);
    }
    return `/app/schedule?${p.toString()}`;
  };

  return (
    <>
      <h1>Schedule board</h1>
      <div className="sb-toolbar" role="toolbar" aria-label="Board controls">
        <Link
          className="crm-btn"
          href={q({ date: shiftDate(view, date, -1) })}
          aria-label="Previous"
        >
          ‹
        </Link>
        <Link className="crm-btn" href={q({ date: today })}>
          Today
        </Link>
        <Link className="crm-btn" href={q({ date: shiftDate(view, date, 1) })} aria-label="Next">
          ›
        </Link>
        <strong>
          {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz }).format(
            range.start,
          )}
          {view !== "day" &&
            ` – ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: tz }).format(new Date(range.end.getTime() - 1))}`}
        </strong>
        {BOARD_VIEWS.map((v) => (
          <Link
            key={v}
            className={`crm-btn${v === view ? " active" : ""}`}
            href={q({ view: v })}
            aria-current={v === view ? "true" : undefined}
          >
            {v[0]!.toUpperCase() + v.slice(1)}
          </Link>
        ))}
        {skills.ok && skills.rows.length > 0 && (
          <form method="get" className="crm-row">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={date} />
            <label>
              <span className="crm-sr">Filter by skill</span>
              <select name="skill" defaultValue={skillId ?? ""} aria-label="Filter by skill">
                <option value="">All skills</option>
                {skills.rows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="crm-btn" type="submit">
              Filter
            </button>
          </form>
        )}
      </div>

      <ScheduleBoard
        range={{
          view: range.view,
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          pxPerHour: range.pxPerHour,
          snapMinutes: range.snapMinutes,
          widthPx: range.widthPx,
          ticks: range.ticks.map((t) => ({
            at: t.at.toISOString(),
            label: t.label,
            major: t.major,
          })),
        }}
        resources={shown.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          type: r.resourceType,
        }))}
        bookings={bookings.rows
          .filter((b) => shownIds.has(b.resourceId))
          .map((b) => ({
            id: b.id,
            resourceId: b.resourceId,
            start: b.startAt.toISOString(),
            end: b.endAt.toISOString(),
            status: b.status,
            woId: b.workOrderId,
            woNumber: b.woNumber,
            woTitle: b.woTitle,
          }))}
        unscheduled={
          unscheduled.ok
            ? unscheduled.rows.map((w) => ({
                id: w.id,
                woNumber: w.woNumber,
                title: w.title,
                estDurationMin: w.estDurationMin,
                priority: w.priority,
              }))
            : []
        }
        tz={tz}
        canEdit={can(ctx.subject, "booking", "create")}
      />
    </>
  );
}
