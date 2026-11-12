import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  bookableResource,
  characteristic,
  resourceBooking,
  resourceCharacteristic,
  workOrder,
  workOrderSkill,
} from "@/db/schema";
import { tenantTimeZone } from "@/server/entities/tenant";
import { can } from "@/server/security/roles";
import { recordAudit } from "./audit";
import { validateImageDataUrl } from "./branding";
import {
  canBookingTransition,
  isBookingStatus,
  occupiesTime,
  overlaps,
  type BookingStatus,
} from "./booking-status";
import {
  FORBIDDEN,
  NOT_FOUND,
  checkRecord,
  fail,
  readScope,
  type Ctx,
  type Result,
} from "./context";
import { invalid, text } from "./leads";
import { isWithinWorkHours, type WorkHours } from "./work-hours";
import { canTransition, type WoStatus } from "./work-order-status";

// Bookings put a resource on a work order for a stretch of time. Creating one schedules the work
// order; the technician then moves it Travelling -> In Progress -> Completed (which drives the
// work order's status), optionally capturing the customer's signature. Problems that should give
// a dispatcher pause (overlap, outside working hours, a missing skill, outside the customer's
// window) come back as warnings rather than refusing the booking.

export type Booking = typeof resourceBooking.$inferSelect;
export type BookingWarning = {
  code: "overlap" | "outside_hours" | "missing_skills" | "outside_window";
  message: string;
};

const isUuid = (v: unknown): v is string => z.string().uuid().safeParse(v).success;
const MAX_SIGNATURE_BYTES = 100 * 1024;
const MAX_BOOKING_MS = 14 * 24 * 3_600_000;

const timeRange = z
  .object({ startAt: z.coerce.date(), endAt: z.coerce.date() })
  .refine((d) => d.endAt > d.startAt, {
    message: "The booking must end after it starts.",
    path: ["endAt"],
  })
  .refine((d) => d.endAt.getTime() - d.startAt.getTime() <= MAX_BOOKING_MS, {
    message: "A booking can't be longer than 14 days.",
    path: ["endAt"],
  });

const createInput = z
  .object({
    workOrderId: z.string().uuid(),
    resourceId: z.string().uuid(),
    notes: text(2000),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .and(timeRange);

/** Everything about a proposed booking a dispatcher should be warned about. */
async function warningsFor(
  tx: Tx,
  p: {
    resource: typeof bookableResource.$inferSelect;
    workOrderId: string | null;
    start: Date;
    end: Date;
    excludeBookingId?: string;
    timeZone: string;
  },
): Promise<BookingWarning[]> {
  const out: BookingWarning[] = [];

  const others = await tx
    .select({ b: resourceBooking, wo: workOrder.woNumber })
    .from(resourceBooking)
    .leftJoin(workOrder, eq(workOrder.id, resourceBooking.workOrderId))
    .where(
      and(
        eq(resourceBooking.resourceId, p.resource.id),
        ne(resourceBooking.status, "cancelled"),
        lt(resourceBooking.startAt, p.end),
        gt(resourceBooking.endAt, p.start),
        p.excludeBookingId ? ne(resourceBooking.id, p.excludeBookingId) : undefined,
      ),
    );
  const clashes = others.filter(
    (o) =>
      occupiesTime(o.b.status as BookingStatus) &&
      overlaps({ start: p.start, end: p.end }, { start: o.b.startAt, end: o.b.endAt }),
  );
  if (clashes.length > 0) {
    out.push({
      code: "overlap",
      message: `${p.resource.name} is already booked at that time${
        clashes[0]!.wo
          ? ` (${clashes
              .map((c) => c.wo)
              .filter(Boolean)
              .join(", ")})`
          : ""
      }.`,
    });
  }

  if (!isWithinWorkHours(p.resource.workHours as WorkHours, p.start, p.end, p.timeZone)) {
    out.push({
      code: "outside_hours",
      message: `That is outside ${p.resource.name}'s working hours.`,
    });
  }

  if (p.workOrderId) {
    const [wo] = await tx.select().from(workOrder).where(eq(workOrder.id, p.workOrderId));
    const required = await tx
      .select({ id: workOrderSkill.characteristicId, name: characteristic.name })
      .from(workOrderSkill)
      .innerJoin(characteristic, eq(characteristic.id, workOrderSkill.characteristicId))
      .where(eq(workOrderSkill.workOrderId, p.workOrderId));
    if (required.length > 0) {
      const has = await tx
        .select({ id: resourceCharacteristic.characteristicId })
        .from(resourceCharacteristic)
        .where(eq(resourceCharacteristic.resourceId, p.resource.id));
      const owned = new Set(has.map((h) => h.id));
      const missing = required.filter((r) => !owned.has(r.id)).map((r) => r.name);
      if (missing.length > 0)
        out.push({
          code: "missing_skills",
          message: `${p.resource.name} doesn't have: ${missing.join(", ")}.`,
        });
    }
    if (
      wo?.timeWindowStart &&
      wo.timeWindowEnd &&
      (p.start < wo.timeWindowStart || p.end > wo.timeWindowEnd)
    ) {
      out.push({ code: "outside_window", message: "That is outside the customer's time window." });
    }
  }
  return out;
}

/** Creates a booking, schedules the work order, and returns any warnings. */
export async function createBooking(
  ctx: Ctx,
  raw: unknown,
): Promise<Result<{ booking: Booking; warnings: BookingWarning[] }>> {
  if (!can(ctx.subject, "booking", "create")) return FORBIDDEN;
  const p = createInput.safeParse(raw);
  if (!p.success) return invalid(p);
  const tz = await tenantTimeZone(ctx.tenantId);
  return withTenant(ctx.tenantId, async (tx) => {
    const [wo] = await tx
      .select()
      .from(workOrder)
      .where(eq(workOrder.id, p.data.workOrderId))
      .for("update");
    const denied = checkRecord(ctx, "work_order", "write", wo);
    if (denied) return denied;
    if (wo!.status !== "unscheduled" && wo!.status !== "scheduled") {
      return fail("conflict", `A ${wo!.status.replace("_", " ")} work order can't be booked.`);
    }
    const active = await tx
      .select({ id: resourceBooking.id })
      .from(resourceBooking)
      .where(
        and(
          eq(resourceBooking.workOrderId, wo!.id),
          ne(resourceBooking.status, "cancelled"),
          ne(resourceBooking.status, "completed"),
        ),
      );
    if (active.length > 0)
      return fail(
        "conflict",
        "This work order is already booked. Cancel or move that booking first.",
      );

    const [resource] = await tx
      .select()
      .from(bookableResource)
      .where(eq(bookableResource.id, p.data.resourceId));
    if (!resource || resource.stateCode !== "active")
      return fail("invalid", "That resource doesn't exist.");

    const warnings = await warningsFor(tx, {
      resource,
      workOrderId: wo!.id,
      start: p.data.startAt,
      end: p.data.endAt,
      timeZone: tz,
    });
    const [booking] = await tx
      .insert(resourceBooking)
      .values({
        tenantId: ctx.tenantId,
        // The booking belongs to the technician it's for, so they can run it from their phone.
        ownerId: resource.userId ?? ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        resourceId: resource.id,
        workOrderId: wo!.id,
        startAt: p.data.startAt,
        endAt: p.data.endAt,
        notes: p.data.notes ?? null,
      })
      .returning();
    if (wo!.status === "unscheduled" && canTransition("unscheduled", "scheduled")) {
      await tx
        .update(workOrder)
        .set({ status: "scheduled", modifiedAt: new Date(), modifiedBy: ctx.userId })
        .where(eq(workOrder.id, wo!.id));
    }
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "booking",
      recordId: booking!.id,
      action: "create",
      changes: {
        workOrder: wo!.woNumber,
        resource: resource.name,
        warnings: warnings.map((w) => w.code),
      },
    });
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "work_order",
      recordId: wo!.id,
      action: "status",
      changes: { status: { from: wo!.status, to: "scheduled" }, viaBooking: booking!.id },
    });
    return { ok: true as const, booking: booking!, warnings };
  });
}

/** Moves a booking that hasn't started to another time and/or resource. */
export async function moveBooking(
  ctx: Ctx,
  id: string,
  raw: unknown,
): Promise<Result<{ booking: Booking; warnings: BookingWarning[] }>> {
  if (!isUuid(id)) return NOT_FOUND;
  // Rescheduling is the dispatcher's job (the same privilege as booking). Technicians run their
  // visits but can't move them, even though they own them.
  if (!can(ctx.subject, "booking", "create")) return FORBIDDEN;
  const p = timeRange.and(z.object({ resourceId: z.string().uuid().optional() })).safeParse(raw);
  if (!p.success) return invalid(p);
  const tz = await tenantTimeZone(ctx.tenantId);
  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(resourceBooking)
      .where(eq(resourceBooking.id, id))
      .for("update");
    const denied = checkRecord(ctx, "booking", "write", row);
    if (denied) return denied;
    if (row!.status !== "scheduled")
      return fail(
        "read_only",
        `This booking is ${row!.status.replace("_", " ")} and can't be moved.`,
      );
    const [resource] = await tx
      .select()
      .from(bookableResource)
      .where(eq(bookableResource.id, p.data.resourceId ?? row!.resourceId));
    if (!resource || resource.stateCode !== "active")
      return fail("invalid", "That resource doesn't exist.");
    const warnings = await warningsFor(tx, {
      resource,
      workOrderId: row!.workOrderId,
      start: p.data.startAt,
      end: p.data.endAt,
      excludeBookingId: id,
      timeZone: tz,
    });
    const [updated] = await tx
      .update(resourceBooking)
      .set({
        resourceId: resource.id,
        ownerId: resource.userId ?? row!.createdBy ?? ctx.userId,
        startAt: p.data.startAt,
        endAt: p.data.endAt,
        modifiedAt: new Date(),
        modifiedBy: ctx.userId,
      })
      .where(eq(resourceBooking.id, id))
      .returning();
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "booking",
      recordId: id,
      action: "move",
      changes: { resource: resource.name, warnings: warnings.map((w) => w.code) },
    });
    return { ok: true as const, booking: updated!, warnings };
  });
}

const statusInput = z.object({
  notes: text(2000),
  signatureDataUrl: z.string().nullable().optional(),
  signedByName: z.string().trim().max(120).nullable().optional(),
});

/**
 * Moves a booking through the technician's flow. Starting work puts the work order In Progress,
 * completing it completes the work order (with the customer's signature if captured), and
 * cancelling an unstarted booking sends the work order back to Unscheduled.
 */
export async function setBookingStatus(
  ctx: Ctx,
  id: string,
  to: unknown,
  raw: unknown = {},
): Promise<Result<{ booking: Booking }>> {
  if (!isUuid(id)) return NOT_FOUND;
  if (!isBookingStatus(to)) return fail("invalid", "That isn't a booking status.");
  const p = statusInput.safeParse(raw ?? {});
  if (!p.success) return invalid(p);

  let signature: string | null = null;
  if (p.data.signatureDataUrl) {
    if (to !== "completed")
      return fail("invalid", "A signature can only be captured when completing the visit.");
    const v = validateImageDataUrl(p.data.signatureDataUrl, {
      types: ["png"],
      maxBytes: MAX_SIGNATURE_BYTES,
      noun: "signature",
    });
    if (!v.ok) return fail("invalid", v.message);
    if (!p.data.signedByName?.trim())
      return fail("invalid", "Enter the name of the person who signed.", {
        issues: [{ path: "signedByName", message: "Enter the name of the person who signed." }],
      });
    signature = v.dataUrl;
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(resourceBooking)
      .where(eq(resourceBooking.id, id))
      .for("update");
    const denied = checkRecord(ctx, "booking", "write", row);
    if (denied) return denied;
    const from = row!.status as BookingStatus;
    if (!canBookingTransition(from, to)) {
      return fail(
        "conflict",
        `A ${from.replace("_", " ")} booking can't go to ${to.replace("_", " ")}.`,
      );
    }
    const now = new Date();
    const patch: Partial<typeof resourceBooking.$inferInsert> = {
      status: to,
      modifiedAt: now,
      modifiedBy: ctx.userId,
    };
    if (to === "travelling") patch.travellingAt = now;
    if (to === "scheduled") patch.travellingAt = null;
    if (to === "in_progress") patch.startedAt = now;
    if (to === "completed") {
      patch.completedAt = now;
      if (signature)
        Object.assign(patch, {
          signatureDataUrl: signature,
          signedByName: p.data.signedByName!.trim(),
          signedAt: now,
        });
    }
    if (p.data.notes) patch.notes = [row!.notes, p.data.notes].filter(Boolean).join("\n");
    const [updated] = await tx
      .update(resourceBooking)
      .set(patch)
      .where(eq(resourceBooking.id, id))
      .returning();

    // The work order follows the visit. This is a platform rule applied directly: the technician
    // doesn't need edit rights on the work order itself.
    if (row!.workOrderId) {
      const [wo] = await tx
        .select()
        .from(workOrder)
        .where(eq(workOrder.id, row!.workOrderId))
        .for("update");
      let target: WoStatus | null = null;
      if (to === "in_progress") target = "in_progress";
      if (to === "completed") target = "completed";
      if (to === "cancelled") {
        const stillBooked = await tx
          .select({ id: resourceBooking.id })
          .from(resourceBooking)
          .where(
            and(
              eq(resourceBooking.workOrderId, wo!.id),
              ne(resourceBooking.id, id),
              inArray(resourceBooking.status, ["scheduled", "travelling", "in_progress"]),
            ),
          );
        if (stillBooked.length === 0) target = "unscheduled";
      }
      if (wo && target && wo.status !== target && canTransition(wo.status as WoStatus, target)) {
        await tx
          .update(workOrder)
          .set({ status: target, modifiedAt: now, modifiedBy: ctx.userId })
          .where(eq(workOrder.id, wo.id));
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          entity: "work_order",
          recordId: wo.id,
          action: "status",
          changes: { status: { from: wo.status, to: target }, viaBooking: id },
        });
      }
    }
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "booking",
      recordId: id,
      action: "status",
      changes: { status: { from, to }, ...(signature ? { signed: true } : {}) },
    });
    return { ok: true as const, booking: updated! };
  });
}

export type BookingRow = Booking & {
  resourceName: string;
  resourceColor: string | null;
  woNumber: string | null;
  woTitle: string | null;
};

const bookingSelect = {
  b: resourceBooking,
  resourceName: bookableResource.name,
  resourceColor: bookableResource.color,
  woNumber: workOrder.woNumber,
  woTitle: workOrder.title,
};
const flat = (r: {
  b: Booking;
  resourceName: string;
  resourceColor: string | null;
  woNumber: string | null;
  woTitle: string | null;
}): BookingRow => ({
  ...r.b,
  resourceName: r.resourceName,
  resourceColor: r.resourceColor,
  woNumber: r.woNumber,
  woTitle: r.woTitle,
});

export async function getBooking(ctx: Ctx, id: string): Promise<Result<{ booking: BookingRow }>> {
  if (!isUuid(id)) return NOT_FOUND;
  return withTenant(ctx.tenantId, async (tx) => {
    const [r] = await tx
      .select(bookingSelect)
      .from(resourceBooking)
      .innerJoin(bookableResource, eq(bookableResource.id, resourceBooking.resourceId))
      .leftJoin(workOrder, eq(workOrder.id, resourceBooking.workOrderId))
      .where(eq(resourceBooking.id, id));
    const denied = checkRecord(ctx, "booking", "read", r?.b);
    return denied ?? { ok: true as const, booking: flat(r!) };
  });
}

/** Bookings in a time range (for the schedule board), optionally for one resource. */
export async function listBookings(
  ctx: Ctx,
  opts: { from: Date; to: Date; resourceId?: string; includeCancelled?: boolean },
): Promise<Result<{ rows: BookingRow[] }>> {
  const scope = readScope(ctx.subject, "booking", resourceBooking.ownerId);
  if (!scope.allowed) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select(bookingSelect)
      .from(resourceBooking)
      .innerJoin(bookableResource, eq(bookableResource.id, resourceBooking.resourceId))
      .leftJoin(workOrder, eq(workOrder.id, resourceBooking.workOrderId))
      .where(
        and(
          scope.where,
          lt(resourceBooking.startAt, opts.to),
          gt(resourceBooking.endAt, opts.from),
          opts.resourceId ? eq(resourceBooking.resourceId, opts.resourceId) : undefined,
          opts.includeCancelled ? undefined : ne(resourceBooking.status, "cancelled"),
        ),
      )
      .orderBy(asc(resourceBooking.startAt));
    return { ok: true as const, rows: rows.map(flat) };
  });
}

/** The signed-in technician's own bookings in a range: what the mobile view shows. */
export async function listMyBookings(
  ctx: Ctx,
  opts: { from: Date; to: Date },
): Promise<Result<{ rows: BookingRow[] }>> {
  if (!can(ctx.subject, "booking", "read")) return FORBIDDEN;
  return withTenant(ctx.tenantId, async (tx) => {
    const rows = await tx
      .select(bookingSelect)
      .from(resourceBooking)
      .innerJoin(bookableResource, eq(bookableResource.id, resourceBooking.resourceId))
      .leftJoin(workOrder, eq(workOrder.id, resourceBooking.workOrderId))
      .where(
        and(
          eq(resourceBooking.ownerId, ctx.userId),
          lt(resourceBooking.startAt, opts.to),
          gt(resourceBooking.endAt, opts.from),
          ne(resourceBooking.status, "cancelled"),
        ),
      )
      .orderBy(asc(resourceBooking.startAt));
    return { ok: true as const, rows: rows.map(flat) };
  });
}
