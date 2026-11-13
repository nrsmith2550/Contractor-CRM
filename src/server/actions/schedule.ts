"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import { createBooking, moveBooking } from "@/server/domain/bookings";
import { buildCtx, type Fail } from "@/server/domain/context";
import type { CmdResult } from "./entities";

async function ctx() {
  const u = await requireUser();
  return buildCtx(u.tenantId, u.userId);
}

const failed = (f: Fail): CmdResult => ({
  ok: false,
  message: f.message,
  code: f.code,
  issues: f.issues as never,
});

/** Drag, resize, keyboard move or reassign on the schedule board. Times are ISO instants (UTC). */
export async function rescheduleBookingAction(
  id: string,
  v: { resourceId?: string; startAt: string; endAt: string },
): Promise<CmdResult> {
  const r = await moveBooking(await ctx(), id, {
    resourceId: v.resourceId,
    startAt: v.startAt,
    endAt: v.endAt,
  });
  if (!r.ok) return failed(r);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Moved.", warnings: r.warnings.map((w) => w.message) };
}

/** Drop an unscheduled work order onto a resource and time: creates the booking. */
export async function scheduleWorkOrderAction(
  workOrderId: string,
  v: { resourceId: string; startAt: string; endAt: string },
): Promise<CmdResult> {
  const r = await createBooking(await ctx(), {
    workOrderId,
    resourceId: v.resourceId,
    startAt: v.startAt,
    endAt: v.endAt,
  });
  if (!r.ok) return failed(r);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Booked.", warnings: r.warnings.map((w) => w.message) };
}
