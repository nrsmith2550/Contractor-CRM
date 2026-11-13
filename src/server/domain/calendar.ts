import { and, asc, eq, gt, gte, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { activity, bookableResource, resourceBooking, systemUser, workOrder } from "@/db/schema";
import { recordHref } from "@/lib/calendar";
import { FORBIDDEN, fail, readScope, type Ctx, type Result } from "./context";

// The calendar: a signed-in user's appointments, tasks with due dates, and bookings in a range,
// or another person's (or everyone's) if their role lets them see other people's records. Times
// are real instants; the page converts them to the business's wall clock for display.

export type CalendarEvent = {
  id: string;
  kind: "appointment" | "task" | "booking";
  title: string;
  start: Date;
  end: Date;
  status: string;
  href: string | null;
  ownerId: string;
  ownerName: string | null;
  /** Booking events carry their resource's name. */
  detail: string | null;
};

const TASK_MINUTES = 30; // how long a task's marker is drawn on a time grid

/** "mine" (default), "all", or one person's id. */
const filterSchema = z.union([z.literal("mine"), z.literal("all"), z.string().uuid()]);

export async function listCalendarEvents(
  ctx: Ctx,
  opts: { from: Date; to: Date; user?: string },
): Promise<Result<{ events: CalendarEvent[]; canSeeOthers: boolean }>> {
  const f = filterSchema.safeParse(opts.user ?? "mine");
  if (!f.success) return fail("invalid", "Choose mine, everyone, or a person.");
  const who = f.data;

  const actScope = readScope(ctx.subject, "activity", activity.ownerId);
  const bookScope = readScope(ctx.subject, "booking", resourceBooking.ownerId);
  if (!actScope.allowed && !bookScope.allowed) return FORBIDDEN;
  const canSeeOthers =
    ctx.subject.privileges.activity?.read === "organization" ||
    ctx.subject.privileges.booking?.read === "organization";
  // Seeing somebody else's calendar needs organization-level read; otherwise only your own.
  if (who !== "mine" && who !== ctx.userId && !canSeeOthers) {
    return fail("forbidden", "You can only see your own calendar.");
  }
  const owner = (col: typeof activity.ownerId | typeof resourceBooking.ownerId): SQL | undefined =>
    who === "all" ? undefined : eq(col, who === "mine" ? ctx.userId : who);

  return withTenant(ctx.tenantId, async (tx) => {
    const events: CalendarEvent[] = [];

    if (actScope.allowed) {
      const rows = await tx
        .select({ a: activity, ownerName: systemUser.fullName })
        .from(activity)
        .leftJoin(systemUser, eq(systemUser.id, activity.ownerId))
        .where(
          and(
            actScope.where,
            owner(activity.ownerId),
            inArray(activity.activityType, ["appointment", "task"]),
            ne(activity.status, "cancelled"),
            or(
              and(
                eq(activity.activityType, "appointment"),
                lt(activity.scheduledStart, opts.to),
                gt(
                  sql`coalesce(${activity.scheduledEnd}, ${activity.scheduledStart} + interval '1 hour')`,
                  opts.from,
                ),
              ),
              and(
                eq(activity.activityType, "task"),
                gte(activity.dueAt, opts.from),
                lt(activity.dueAt, opts.to),
              ),
            ),
          ),
        )
        .orderBy(asc(activity.scheduledStart), asc(activity.dueAt));
      for (const { a, ownerName } of rows) {
        const isTask = a.activityType === "task";
        const start = isTask ? a.dueAt : a.scheduledStart;
        if (!start) continue;
        const end = isTask
          ? new Date(start.getTime() + TASK_MINUTES * 60_000)
          : (a.scheduledEnd ?? new Date(start.getTime() + 60 * 60_000));
        events.push({
          id: a.id,
          kind: isTask ? "task" : "appointment",
          title: a.subject,
          start,
          end: end > start ? end : new Date(start.getTime() + 60_000),
          status: a.status,
          href: recordHref(a.regardingType, a.regardingId),
          ownerId: a.ownerId,
          ownerName,
          detail: a.description,
        });
      }
    }

    if (bookScope.allowed) {
      const rows = await tx
        .select({
          b: resourceBooking,
          resource: bookableResource.name,
          woNumber: workOrder.woNumber,
          woTitle: workOrder.title,
          ownerName: systemUser.fullName,
        })
        .from(resourceBooking)
        .innerJoin(bookableResource, eq(bookableResource.id, resourceBooking.resourceId))
        .leftJoin(workOrder, eq(workOrder.id, resourceBooking.workOrderId))
        .leftJoin(systemUser, eq(systemUser.id, resourceBooking.ownerId))
        .where(
          and(
            bookScope.where,
            owner(resourceBooking.ownerId),
            ne(resourceBooking.status, "cancelled"),
            lt(resourceBooking.startAt, opts.to),
            gt(resourceBooking.endAt, opts.from),
          ),
        )
        .orderBy(asc(resourceBooking.startAt));
      for (const r of rows) {
        events.push({
          id: r.b.id,
          kind: "booking",
          title: [r.woNumber, r.woTitle].filter(Boolean).join(" ") || "Booking",
          start: r.b.startAt,
          end: r.b.endAt,
          status: r.b.status,
          href: r.b.workOrderId ? `/app/work-orders/${r.b.workOrderId}` : null,
          ownerId: r.b.ownerId,
          ownerName: r.ownerName,
          detail: r.resource,
        });
      }
    }

    events.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
    return { ok: true as const, events, canSeeOthers };
  });
}
