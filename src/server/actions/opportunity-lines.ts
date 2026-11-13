"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import { buildCtx, type Fail } from "@/server/domain/context";
import { parseMoneyToCents } from "@/server/domain/lead-import";
import { addOpportunityLine, removeOpportunityLine } from "@/server/domain/opportunity-lines";
import type { CmdResult } from "./entities";

const failed = (f: Fail): CmdResult => ({ ok: false, message: f.message, code: f.code });

async function ctx() {
  const u = await requireUser();
  return buildCtx(u.tenantId, u.userId);
}

export async function addOpportunityLineAction(
  oppId: string,
  v: Record<string, string>,
): Promise<CmdResult> {
  const price = v.unitPrice?.trim() ? parseMoneyToCents(v.unitPrice) : null;
  const discount = v.discount?.trim() ? parseMoneyToCents(v.discount) : null;
  if (price === undefined || discount === undefined) {
    return { ok: false, message: "Price and discount must be valid amounts." };
  }
  const qty = Number(v.quantity);
  if (!Number.isFinite(qty)) return { ok: false, message: "Enter a quantity." };
  const r = await addOpportunityLine(await ctx(), oppId, {
    productId: v.productId || null,
    description: v.description,
    quantity: qty,
    unitPriceCents: price ?? undefined,
    discountCents: discount ?? undefined,
  });
  if (!r.ok) return failed(r);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Product or service added" };
}

export async function removeOpportunityLineAction(
  oppId: string,
  lineId: string,
): Promise<CmdResult> {
  const r = await removeOpportunityLine(await ctx(), oppId, lineId);
  if (!r.ok) return failed(r);
  revalidatePath("/app", "layout");
  return { ok: true };
}
