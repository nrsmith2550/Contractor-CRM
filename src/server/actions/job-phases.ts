"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import { buildCtx, type Fail } from "@/server/domain/context";
import {
  addJobPhase,
  removeJobPhase,
  setJobPhaseStatus,
  updateJobPhase,
} from "@/server/domain/job-phases";
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

const minutesOf = (v: string | undefined): number | null | undefined => {
  const t = v?.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

export async function addJobPhaseAction(workOrderId: string, v: V): Promise<CmdResult> {
  const minutes = minutesOf(v.estDurationMin);
  if (minutes === undefined) return { ok: false, message: "Enter the time estimate in minutes." };
  const r = await addJobPhase(await ctx(), workOrderId, {
    title: v.title,
    instructions: v.instructions || undefined,
    estDurationMin: minutes,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: `Phase ${r.phase.phaseNumber} added` };
}

export async function updateJobPhaseAction(phaseId: string, v: V): Promise<CmdResult> {
  const minutes = minutesOf(v.estDurationMin);
  if (minutes === undefined) return { ok: false, message: "Enter the time estimate in minutes." };
  const r = await updateJobPhase(await ctx(), phaseId, {
    title: v.title,
    instructions: v.instructions ?? "",
    estDurationMin: minutes,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Phase saved" };
}

export async function setJobPhaseStatusAction(phaseId: string, to: string): Promise<CmdResult> {
  const r = await setJobPhaseStatus(await ctx(), phaseId, to);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true };
}

export async function removeJobPhaseAction(phaseId: string): Promise<CmdResult> {
  const r = await removeJobPhase(await ctx(), phaseId);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true };
}
