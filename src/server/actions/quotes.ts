"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/http";
import { createPriceList, createTaxRate, setPriceListItem } from "@/server/domain/catalog";
import { buildCtx, type Fail } from "@/server/domain/context";
import { parseMoneyToCents } from "@/server/domain/lead-import";
import { emailQuote } from "@/server/domain/quote-email";
import {
  activateQuote,
  addLine,
  createQuote,
  loseQuote,
  removeLine,
  reviseQuote,
  updateQuote,
  winQuote,
} from "@/server/domain/quotes";
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

/** "$1,250.50" -> cents. Blank -> null. Not a number -> undefined. */
const cents = (s: string | undefined) => (s === undefined ? null : parseMoneyToCents(s));

/** "8.25" -> 825 basis points. Blank -> null. Invalid -> undefined. */
function percentToBp(s: string | undefined): number | null | undefined {
  const t = (s ?? "").trim().replace(/%$/, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

type V = Record<string, string>;

export async function createQuoteAction(opportunityId: string, v: V): Promise<CmdResult> {
  const r = await createQuote(await ctx(), {
    name: v.name,
    opportunityId: opportunityId || null,
  });
  if (!r.ok) return failed(r);
  refresh();
  redirect(`/app/quotes/${r.quote.id}`);
}

export async function updateQuoteAction(id: string, v: V): Promise<CmdResult> {
  const freight = cents(v.freight);
  if (freight === undefined) return { ok: false, message: "Freight isn't a valid amount." };
  const patch: Record<string, unknown> = {
    name: v.name,
    paymentTerms: v.paymentTerms,
    termsText: v.termsText,
    freightCents: freight ?? 0,
  };
  if (v.discountKind === "percent") {
    const bp = percentToBp(v.discountValue);
    if (bp === undefined)
      return { ok: false, message: "Discount percent isn't valid (e.g. 10 or 7.5)." };
    patch.discountPercentBp = bp;
    if (bp === null) patch.discountAmountCents = null;
  } else if (v.discountKind === "amount") {
    const c = cents(v.discountValue);
    if (c === undefined) return { ok: false, message: "Discount amount isn't valid." };
    patch.discountAmountCents = c;
    if (c === null) patch.discountPercentBp = null;
  } else {
    patch.discountPercentBp = null;
    patch.discountAmountCents = null;
  }
  const r = await updateQuote(await ctx(), id, patch);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Saved" };
}

export async function addLineAction(quoteId: string, v: V): Promise<CmdResult> {
  const price = cents(v.unitPrice);
  const discount = cents(v.discount);
  if (price === undefined || discount === undefined) {
    return { ok: false, message: "Price and discount must be valid amounts." };
  }
  const qty = Number(v.quantity);
  if (!Number.isFinite(qty)) return { ok: false, message: "Enter a quantity." };
  const rate = percentToBp(v.taxPercent);
  if (rate === undefined) return { ok: false, message: "Tax percent isn't valid." };
  const r = await addLine(await ctx(), quoteId, {
    productId: v.productId || null,
    description: v.description,
    quantity: qty,
    unitPriceCents: price ?? undefined,
    discountCents: discount ?? undefined,
    taxRateBp: rate ?? undefined,
  });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Line added" };
}

export async function removeLineAction(quoteId: string, lineId: string): Promise<CmdResult> {
  const r = await removeLine(await ctx(), quoteId, lineId);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true };
}

export async function quoteCommandAction(
  command: "activate" | "revise" | "win" | "lose",
  id: string,
  opts: { closeOpportunity?: boolean } = {},
): Promise<CmdResult> {
  const c = await ctx();
  refresh();
  switch (command) {
    case "activate": {
      const r = await activateQuote(c, id);
      return r.ok ? { ok: true, message: "Quote activated. It is now read-only." } : failed(r);
    }
    case "revise": {
      const r = await reviseQuote(c, id);
      return r.ok
        ? {
            ok: true,
            message: `Created ${r.quote.quoteNumber}.`,
            redirectTo: `/app/quotes/${r.quote.id}`,
          }
        : failed(r);
    }
    case "win": {
      const r = await winQuote(c, id, { closeOpportunity: opts.closeOpportunity });
      return r.ok
        ? {
            ok: true,
            message: `Won. Created order ${r.order.orderNumber}.`,
            redirectTo: `/app/orders/${r.order.id}`,
          }
        : failed(r);
    }
    case "lose": {
      const r = await loseQuote(c, id);
      return r.ok ? { ok: true, message: "Quote closed as lost." } : failed(r);
    }
  }
}

export async function createPriceListAction(v: V): Promise<CmdResult> {
  const r = await createPriceList(await ctx(), { name: v.name });
  if (!r.ok) return failed(r);
  refresh();
  redirect(`/app/price-lists/${r.priceList.id}`);
}

export async function setPriceAction(priceListId: string, v: V): Promise<CmdResult> {
  const amount = cents(v.price);
  if (amount === null || amount === undefined)
    return { ok: false, message: "Enter a valid price." };
  const r = await setPriceListItem(await ctx(), priceListId, v.productId ?? "", amount);
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Price saved" };
}

export async function createTaxRateAction(v: V): Promise<CmdResult> {
  const bp = percentToBp(v.percent);
  if (bp === null || bp === undefined)
    return { ok: false, message: "Enter the rate as a percent, e.g. 8.25." };
  const r = await createTaxRate(await ctx(), { name: v.name, rateBp: bp });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: "Tax rate added" };
}

export async function emailQuoteAction(quoteId: string, v: V): Promise<CmdResult> {
  const r = await emailQuote(await ctx(), quoteId, { to: v.to, message: v.message });
  if (!r.ok) return failed(r);
  refresh();
  return { ok: true, message: `Quote emailed to ${r.to}.` };
}
