import { TechnicianBookings, type MyBooking } from "@/components/form/TechnicianBookings";
import { utcToZonedInput, zonedToUtc } from "@/lib/tz";
import { requireUser } from "@/server/auth/http";
import { listMyBookings } from "@/server/domain/bookings";
import { buildCtx } from "@/server/domain/context";
import { listProductChoices, listWorkOrderLines } from "@/server/domain/work-order-lines";
import { tenantTimeZone } from "@/server/entities/tenant";

export const metadata = { title: "My visits" };

// The technician's phone view: today's visits first, then the rest of the week.
export default async function MyBookingsPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const tz = await tenantTimeZone(user.tenantId);

  const today = utcToZonedInput(new Date(), tz).slice(0, 10);
  const from = zonedToUtc(`${today}T00:00`, tz)!;
  const to = new Date(from.getTime() + 8 * 86_400_000);
  const res = await listMyBookings(ctx, { from, to });
  if (!res.ok) {
    return (
      <>
        <h1>My visits</h1>
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      </>
    );
  }

  const dayLabel = (d: string) =>
    d === today
      ? "Today"
      : new Intl.DateTimeFormat("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }).format(new Date(`${d}T00:00:00Z`));
  const time = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(
      d,
    );

  const choices = await listProductChoices(ctx);
  const partsByWo = new Map<string, MyBooking["parts"]>();
  for (const id of new Set(
    res.rows.map((r) => r.workOrderId).filter((x): x is string => Boolean(x)),
  )) {
    const lines = await listWorkOrderLines(ctx, id);
    partsByWo.set(
      id,
      lines.ok
        ? lines.parts.map((p) => ({
            id: p.id,
            description: p.description,
            quantityMilli: p.quantityMilli,
          }))
        : [],
    );
  }

  const days: { label: string; bookings: MyBooking[] }[] = [];
  for (const b of res.rows) {
    const key = utcToZonedInput(b.startAt, tz).slice(0, 10);
    const label = dayLabel(key);
    let day = days.find((x) => x.label === label);
    if (!day) days.push((day = { label, bookings: [] }));
    day.bookings.push({
      id: b.id,
      workOrderId: b.workOrderId,
      parts: b.workOrderId ? (partsByWo.get(b.workOrderId) ?? []) : [],
      status: b.status,
      when: `${time(b.startAt)} – ${time(b.endAt)}`,
      woNumber: b.woNumber,
      woTitle: b.woTitle,
      instructions: b.woInstructions,
      address: b.woAddress,
      notes: b.notes,
      signedByName: b.signedByName,
    });
  }
  return (
    <>
      <h1>My visits</h1>
      <TechnicianBookings days={days} products={choices.ok ? choices.rows : []} />
    </>
  );
}
