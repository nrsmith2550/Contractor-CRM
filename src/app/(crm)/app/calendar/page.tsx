import { CalendarView } from "@/components/calendar/CalendarView";
import { isDate } from "@/lib/board";
import { wallClock } from "@/lib/calendar";
import { requireUser } from "@/server/auth/http";
import { listUsers } from "@/server/auth/invitations";
import { buildCtx } from "@/server/domain/context";
import { tenantTimeZone } from "@/server/entities/tenant";
import { can } from "@/server/security/roles";

export const metadata = { title: "Calendar" };

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const tz = await tenantTimeZone(user.tenantId);
  const canSeeOthers =
    ctx.subject.privileges.activity?.read === "organization" ||
    ctx.subject.privileges.booking?.read === "organization";
  const users = canSeeOthers ? (await listUsers(user.tenantId)).filter((u) => !u.disabledAt) : [];
  return (
    <>
      <h1>Calendar</h1>
      <p>
        Your appointments, tasks with due dates and bookings. Click or drag across a time to add an
        appointment.
      </p>
      <CalendarView
        nowWall={wallClock(new Date(), tz)}
        startDate={isDate(date) ? date : undefined}
        canSeeOthers={canSeeOthers}
        users={users.map((u) => ({ id: u.id, label: u.fullName }))}
        canCreate={can(ctx.subject, "activity", "create")}
      />
    </>
  );
}
