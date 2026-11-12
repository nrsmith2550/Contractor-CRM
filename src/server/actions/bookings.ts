"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import { createBooking, setBookingStatus } from "@/server/domain/bookings";
import { buildCtx, type Fail } from "@/server/domain/context";
import {
  createCharacteristic,
  createResource,
  setWorkOrderSkills,
  updateResource,
} from "@/server/domain/resources";
import { WEEKDAYS, type WorkHours } from "@/server/domain/work-hours";
import { zonedToUtc } from "@/lib/tz";
import { tenantTimeZone } from "@/server/entities/tenant";
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
const refresh = () => revalidatePath("/app", "layout");

type V = Record<string, string>;

/** Books a resource onto a work order. Times are entered in the business's zone. */
export async function createBookingAction(workOrderId: string, v: V): Promise<CmdResult> {
  const c = await ctx();
  const tz = await tenantTimeZone(c.tenantId);
  const startAt = zonedToUtc(v.start ?? "", tz);
  const endAt = zonedToUtc(v.end ?? "", tz);
  if (!startAt || !endAt) return { ok: false, message: "Enter a start and end date and time." };
  const r = await createBooking(c, {
    workOrderId,
    resourceId: v.resourceId,
    startAt,
    endAt,
    notes: v.notes,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Booked.", warnings: r.warnings.map((w) => w.message) };
}

export type BookingCommand = "travelling" | "scheduled" | "in_progress" | "completed" | "cancelled";

/** Moves a booking through the technician's flow, with the signature when completing. */
export async function bookingStatusAction(
  id: string,
  to: BookingCommand,
  v: { notes?: string; signatureDataUrl?: string; signedByName?: string } = {},
): Promise<CmdResult> {
  const r = await setBookingStatus(await ctx(), id, to, {
    notes: v.notes,
    signatureDataUrl: v.signatureDataUrl || null,
    signedByName: v.signedByName || null,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Updated." };
}

export async function createSkillAction(v: V): Promise<CmdResult> {
  const r = await createCharacteristic(await ctx(), { name: v.name });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Skill added" };
}

/** "08:00-12:00, 13:00-17:00" -> intervals. Blank is a day off. */
export async function parseDayHours(
  text: string,
): Promise<{ start: string; end: string }[] | null> {
  const t = text.trim();
  if (t === "") return [];
  const out: { start: string; end: string }[] = [];
  for (const part of t.split(",")) {
    const m = /^\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/.exec(part);
    if (!m) return null;
    out.push({ start: m[1]!, end: m[2]! });
  }
  return out;
}

async function hoursFrom(
  v: V,
): Promise<{ ok: true; hours: WorkHours } | { ok: false; message: string }> {
  const hours = {} as WorkHours;
  for (const d of WEEKDAYS) {
    const parsed = await parseDayHours(v[`hours_${d}`] ?? "");
    if (!parsed)
      return {
        ok: false,
        message: `Working hours for ${d.toUpperCase()} should look like 08:00-12:00, 13:00-17:00.`,
      };
    hours[d] = parsed;
  }
  return { ok: true, hours };
}

export async function createResourceAction(v: V): Promise<CmdResult> {
  const h = await hoursFrom(v);
  if (!h.ok) return { ok: false, message: h.message };
  const r = await createResource(await ctx(), {
    name: v.name,
    resourceType: v.resourceType || undefined,
    userId: v.userId || null,
    color: v.color || null,
    workHours: h.hours,
    skillIds: v.skillIds ? v.skillIds.split(",").filter(Boolean) : [],
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: `${r.resource.name} added.` };
}

export async function updateResourceAction(id: string, v: V): Promise<CmdResult> {
  const h = await hoursFrom(v);
  if (!h.ok) return { ok: false, message: h.message };
  const r = await updateResource(await ctx(), id, {
    name: v.name,
    userId: v.userId || null,
    color: v.color || null,
    workHours: h.hours,
    skillIds: v.skillIds ? v.skillIds.split(",").filter(Boolean) : [],
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Saved" };
}

export async function workOrderSkillsAction(
  workOrderId: string,
  skillIds: string[],
): Promise<CmdResult> {
  const r = await setWorkOrderSkills(await ctx(), workOrderId, skillIds);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Required skills saved" };
}
