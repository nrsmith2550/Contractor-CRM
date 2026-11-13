import { rangeFromCalendar, wallClock } from "@/lib/calendar";
import { requireUser } from "@/server/auth/http";
import { listCalendarEvents } from "@/server/domain/calendar";
import { buildCtx } from "@/server/domain/context";
import { tenantTimeZone } from "@/server/entities/tenant";

export const dynamic = "force-dynamic";

/** Events for the visible range, in FullCalendar's format, as wall-clock times in the business's zone. */
export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const tz = await tenantTimeZone(user.tenantId);
  const range = rangeFromCalendar(url.searchParams.get("start"), url.searchParams.get("end"), tz);
  if (!range) return Response.json({ error: "That isn't a valid date range." }, { status: 400 });

  const res = await listCalendarEvents(await buildCtx(user.tenantId, user.userId), {
    ...range,
    user: url.searchParams.get("user") ?? "mine",
  });
  if (!res.ok)
    return Response.json({ error: res.message }, { status: res.code === "forbidden" ? 403 : 400 });

  return Response.json(
    res.events.map((e) => ({
      id: `${e.kind}:${e.id}`,
      title: e.title,
      start: wallClock(e.start, tz),
      end: wallClock(e.end, tz),
      allDay: false,
      classNames: [`cal-${e.kind}`, `cal-st-${e.status}`],
      extendedProps: {
        kind: e.kind,
        status: e.status,
        href: e.href,
        owner: e.ownerName,
        detail: e.detail,
      },
    })),
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
