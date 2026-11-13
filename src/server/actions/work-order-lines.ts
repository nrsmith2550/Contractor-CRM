"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import { buildCtx, type Fail } from "@/server/domain/context";
import { parseMoneyToCents } from "@/server/domain/lead-import";
import { addLabour, addPart, removeLabour, removePart } from "@/server/domain/work-order-lines";
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

export async function addPartAction(workOrderId: string, v: V): Promise<CmdResult> {
  const price = v.unitPrice?.trim() ? parseMoneyToCents(v.unitPrice) : null;
  if (price === undefined) return { ok: false, message: "The price isn't a valid amount." };
  const qty = Number(v.quantity);
  if (!Number.isFinite(qty)) return { ok: false, message: "Enter a quantity." };
  const r = await addPart(await ctx(), workOrderId, {
    productId: v.productId || null,
    description: v.description,
    quantity: qty,
    unitPriceCents: price ?? undefined,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Part added" };
}

export async function addLabourAction(workOrderId: string, v: V): Promise<CmdResult> {
  const rate = parseMoneyToCents(v.rate ?? "");
  if (rate === undefined || rate === null)
    return { ok: false, message: "Enter the hourly rate as an amount." };
  const r = await addLabour(await ctx(), workOrderId, {
    description: v.description,
    minutes: Number(v.minutes),
    hourlyRateCents: rate,
    resourceId: v.resourceId || null,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Labour added" };
}

export async function removePartAction(workOrderId: string, lineId: string): Promise<CmdResult> {
  const r = await removePart(await ctx(), workOrderId, lineId);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true };
}

export async function removeLabourAction(workOrderId: string, lineId: string): Promise<CmdResult> {
  const r = await removeLabour(await ctx(), workOrderId, lineId);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true };
}
