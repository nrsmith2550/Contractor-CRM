import { TechnicianBookings, type MyBooking } from "@/components/form/TechnicianBookings";
import { utcToZonedInput, zonedToUtc } from "@/lib/tz";
import { requireUser } from "@/server/auth/http";
import { listMyBookings } from "@/server/domain/bookings";
import { buildCtx } from "@/server/domain/context";
import { tenantTimeZone } from "@/server/entities/tenant";

export const metadata = { title: "My bookings" };

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
        <h1>My bookings</h1>
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

  const days: { label: string; bookings: MyBooking[] }[] = [];
  for (const b of res.rows) {
    const key = utcToZonedInput(b.startAt, tz).slice(0, 10);
    const label = dayLabel(key);
    let day = days.find((x) => x.label === label);
    if (!day) days.push((day = { label, bookings: [] }));
    day.bookings.push({
      id: b.id,
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
      <h1>My bookings</h1>
      <TechnicianBookings days={days} />
    </>
  );
}
