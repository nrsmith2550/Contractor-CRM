"use server";

import { revalidatePath } from "next/cache";
import { fromWallClock } from "@/lib/calendar";
import { requireUser } from "@/server/auth/http";
import { addActivity, completeActivity } from "@/server/domain/activities";
import { buildCtx } from "@/server/domain/context";
import { tenantTimeZone } from "@/server/entities/tenant";
import type { CmdResult } from "./entities";

type Fail = { ok: false; message: string; code?: string; issues?: unknown };
const failed = (f: Fail): CmdResult => ({
  ok: false,
  message: f.message,
  code: f.code,
  issues: f.issues as never,
});

/** Log a phone call or add a task to a record's timeline. A due date means the end of that day. */
export async function logActivityAction(
  regardingType: string,
  regardingId: string,
  v: {
    type: "task" | "phone_call";
    subject: string;
    description?: string;
    due?: string;
    direction?: string;
    priority?: string;
  },
): Promise<CmdResult> {
  const user = await requireUser();
  const tz = await tenantTimeZone(user.tenantId);
  let dueAt: Date | null = null;
  if (v.type === "task" && v.due) {
    dueAt = fromWallClock(`${v.due}T17:00`, tz);
    if (!dueAt) return { ok: false, message: "Enter a valid due date." };
  }
  const r = await addActivity(await buildCtx(user.tenantId, user.userId), {
    activityType: v.type,
    subject: v.subject,
    description: v.description,
    regardingType,
    regardingId,
    dueAt,
    direction: v.type === "phone_call" ? v.direction : null,
    priority: v.type === "task" ? v.priority : undefined,
  });
  if (!r.ok) return failed(r);
  revalidatePath("/app", "layout");
  return { ok: true, message: v.type === "task" ? "Task added." : "Call logged." };
}

/** Mark a task or call done. */
export async function completeActivityAction(id: string): Promise<CmdResult> {
  const user = await requireUser();
  const r = await completeActivity(await buildCtx(user.tenantId, user.userId), id);
  if (!r.ok) return failed(r);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Marked done." };
}
