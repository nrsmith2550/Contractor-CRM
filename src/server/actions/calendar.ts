"use server";

import { revalidatePath } from "next/cache";
import { fromWallClock } from "@/lib/calendar";
import { requireUser } from "@/server/auth/http";
import { addActivity } from "@/server/domain/activities";
import { buildCtx } from "@/server/domain/context";
import { tenantTimeZone } from "@/server/entities/tenant";
import type { CmdResult } from "./entities";

/** Quick-create an appointment from a selected slot. Times are wall-clock in the business's zone. */
export async function createAppointmentAction(v: {
  subject: string;
  start: string;
  end: string;
  description?: string;
}): Promise<CmdResult> {
  const user = await requireUser();
  const tz = await tenantTimeZone(user.tenantId);
  const start = fromWallClock(v.start, tz);
  const end = fromWallClock(v.end, tz);
  if (!start || !end) return { ok: false, message: "Enter a start and end date and time." };
  if (end <= start) {
    return {
      ok: false,
      message: "The appointment must end after it starts.",
      issues: [{ path: "end", message: "End must be after the start" }],
    };
  }
  const r = await addActivity(await buildCtx(user.tenantId, user.userId), {
    activityType: "appointment",
    subject: v.subject,
    description: v.description,
    scheduledStart: start,
    scheduledEnd: end,
  });
  if (!r.ok) return { ok: false, message: r.message, code: r.code, issues: r.issues as never };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Appointment added." };
}
