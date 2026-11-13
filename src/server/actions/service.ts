"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import {
  cancelCase,
  convertToWorkOrder,
  createQueue,
  createSubject,
  reactivateCase,
  resolveCase,
  setCaseStatus,
} from "@/server/domain/cases";
import { buildCtx, type Fail } from "@/server/domain/context";
import { setWorkOrderStatus } from "@/server/domain/work-orders";
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
export type CaseCommand =
  "hold" | "waiting" | "resume" | "resolve" | "cancel" | "reactivate" | "convert";

export async function caseCommandAction(
  command: CaseCommand,
  id: string,
  v: V = {},
): Promise<CmdResult> {
  const c = await ctx();
  refresh();
  switch (command) {
    case "hold":
    case "waiting":
    case "resume": {
      const to =
        command === "hold"
          ? "on_hold"
          : command === "waiting"
            ? "waiting_on_customer"
            : "in_progress";
      const r = await setCaseStatus(c, id, to);
      return r.ok ? { ok: true, message: "Status updated." } : failed(r);
    }
    case "resolve": {
      const minutes = v.billableMinutes?.trim() ? Number(v.billableMinutes) : null;
      if (minutes !== null && !Number.isInteger(minutes))
        return { ok: false, message: "Billable minutes must be a whole number." };
      const r = await resolveCase(c, id, {
        resolution: v.resolution ?? "",
        billableMinutes: minutes,
      });
      return r.ok ? { ok: true, message: "Request resolved." } : failed(r);
    }
    case "cancel": {
      const r = await cancelCase(c, id, v.reason);
      return r.ok ? { ok: true, message: "Request cancelled." } : failed(r);
    }
    case "reactivate": {
      const r = await reactivateCase(c, id);
      return r.ok
        ? { ok: true, message: "Request reactivated. Its SLA clock restarted." }
        : failed(r);
    }
    case "convert": {
      const r = await convertToWorkOrder(c, id, { title: v.title || undefined });
      return r.ok
        ? {
            ok: true,
            message: `Created ${r.workOrder.woNumber}.`,
            redirectTo: `/app/jobs/${r.workOrder.id}`,
          }
        : failed(r);
    }
  }
}

export async function workOrderStatusAction(id: string, to: string): Promise<CmdResult> {
  const r = await setWorkOrderStatus(await ctx(), id, to);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Status updated." };
}

export async function createSubjectAction(v: V): Promise<CmdResult> {
  const r = await createSubject(await ctx(), { name: v.name, parentId: v.parentId || null });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Subject added" };
}

export async function createQueueAction(v: V): Promise<CmdResult> {
  const r = await createQueue(await ctx(), { name: v.name });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Queue added" };
}
