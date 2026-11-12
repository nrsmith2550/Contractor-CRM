"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ENTITIES } from "@/entities";
import type { EntityKey } from "@/entities/types";
import { parseCsv } from "@/lib/csv";
import { requireUser } from "@/server/auth/http";
import { addNote } from "@/server/domain/activities";
import { listAccounts, listContacts } from "@/server/domain/accounts";
import { buildCtx, type Fail } from "@/server/domain/context";
import {
  importLeads,
  parseMoneyToCents,
  suggestMapping,
  type ColumnMapping,
} from "@/server/domain/lead-import";
import {
  disqualifyLead,
  markLeadContacted,
  qualifyLead,
  reactivateLead,
} from "@/server/domain/leads";
import {
  closeAsLost,
  closeAsWon,
  moveStage,
  reopenOpportunity,
} from "@/server/domain/opportunities";
import { OPS } from "@/server/entities/registry";
import { tenantTimeZone } from "@/server/entities/tenant";
import { zonedToUtc } from "@/lib/tz";

export type CmdResult =
  | { ok: true; message?: string; redirectTo?: string }
  | {
      ok: false;
      message: string;
      code?: string;
      issues?: { path: string; message: string }[];
      duplicates?: unknown;
      missing?: { field: string; label: string }[];
    };

async function ctx() {
  const u = await requireUser();
  return buildCtx(u.tenantId, u.userId);
}

const failed = (f: Fail): CmdResult => ({
  ok: false,
  message: f.message,
  code: f.code,
  issues: f.issues as never,
  duplicates: f.duplicates,
  missing: f.missing as never,
});

const isKey = (k: unknown): k is EntityKey => typeof k === "string" && k in ENTITIES;

/** Create or update a record from the generic form. Dollar amounts become integer cents here. */
export async function saveRecordAction(
  key: EntityKey,
  id: string | null,
  values: Record<string, string | boolean>,
): Promise<CmdResult> {
  if (!isKey(key)) return { ok: false, message: "Unknown record type." };
  const meta = ENTITIES[key];
  const payload: Record<string, unknown> = {};
  const tz = await tenantTimeZone((await requireUser()).tenantId);
  for (const f of meta.fields) {
    const v = values[f.name];
    if (v === undefined) continue;
    if (f.type === "checkbox") payload[f.name] = v === true || v === "true";
    else if (f.type === "money" || f.type === "number") {
      const s = String(v).trim();
      if (s === "") {
        if (!f.notNullable) payload[f.name] = null;
        continue;
      }
      if (f.type === "number") {
        payload[f.name] = Number(s);
        continue;
      }
      const cents = parseMoneyToCents(s);
      if (cents === undefined || cents === null) {
        return {
          ok: false,
          message: `${f.label} isn't a valid amount.`,
          issues: [{ path: f.name, message: "Not a valid amount" }],
        };
      }
      payload[f.name] = cents;
    } else if (f.type === "datetime") {
      const text = String(v).trim();
      if (text === "") {
        payload[f.name] = null;
        continue;
      }
      const at = zonedToUtc(text, tz);
      if (!at) {
        return {
          ok: false,
          message: `${f.label} isn't a valid date and time.`,
          issues: [{ path: f.name, message: "Not a valid date and time" }],
        };
      }
      payload[f.name] = at.toISOString();
    } else if (v === "" && (f.type === "select" || f.type === "lookup")) {
      if (!f.notNullable) payload[f.name] = null;
    } else payload[f.name] = String(v);
  }

  const c = await ctx();
  const res = id ? await OPS[key].update(c, id, payload) : await OPS[key].create(c, payload);
  if (!res.ok) return failed(res);
  revalidatePath("/app", "layout");
  if (!id) redirect(`/app/${meta.slug}/${res.row.id}`);
  return { ok: true, message: "Saved" };
}

const cents = (s: string | undefined) =>
  s === undefined || s.trim() === "" ? undefined : parseMoneyToCents(s);

/** Command-bar actions on a record (qualify, close as won, move stage, …). */
export async function recordCommandAction(
  command: string,
  key: EntityKey,
  id: string,
  v: Record<string, string> = {},
): Promise<CmdResult> {
  if (!isKey(key) || !z.string().uuid().safeParse(id).success) {
    return { ok: false, message: "Unknown record." };
  }
  const c = await ctx();
  let res: { ok: true; message: string; redirectTo?: string } | Fail;

  switch (`${key}:${command}`) {
    case "lead:qualify": {
      const r = await qualifyLead(c, id, {
        account: v.account || undefined,
        contact: v.contact || undefined,
        createOpportunity: v.createOpportunity !== "false",
      });
      res = r.ok
        ? {
            ok: true,
            message: "Lead qualified.",
            redirectTo: r.opportunityId
              ? `/app/opportunities/${r.opportunityId}`
              : `/app/accounts/${r.accountId}`,
          }
        : r;
      break;
    }
    case "lead:contacted": {
      const r = await markLeadContacted(c, id);
      res = r.ok ? { ok: true, message: "Marked as contacted." } : r;
      break;
    }
    case "lead:disqualify": {
      const r = await disqualifyLead(c, id, v.reason);
      res = r.ok ? { ok: true, message: "Lead disqualified." } : r;
      break;
    }
    case "lead:reactivate": {
      const r = await reactivateLead(c, id);
      res = r.ok ? { ok: true, message: "Lead reactivated." } : r;
      break;
    }
    case "opportunity:stage": {
      const r = await moveStage(c, id, v.stage);
      res = r.ok ? { ok: true, message: `Moved to ${r.opportunity.stage}.` } : r;
      break;
    }
    case "opportunity:won": {
      const amount = cents(v.actualRevenue);
      if (amount === undefined || amount === null) {
        return { ok: false, code: "invalid", message: "Enter the actual revenue." };
      }
      const r = await closeAsWon(c, id, {
        actualRevenueCents: amount,
        actualCloseDate: v.actualCloseDate,
        competitor: v.competitor,
        reason: v.reason,
      });
      res = r.ok
        ? {
            ok: true,
            message: r.accountBecameCustomer ? "Won. The account is now a customer." : "Won.",
          }
        : r;
      break;
    }
    case "opportunity:lost": {
      const r = await closeAsLost(c, id, {
        reason: v.reason ?? "",
        competitor: v.competitor,
        actualCloseDate: v.actualCloseDate,
      });
      res = r.ok ? { ok: true, message: "Closed as lost." } : r;
      break;
    }
    case "opportunity:reopen": {
      const r = await reopenOpportunity(c, id);
      res = r.ok ? { ok: true, message: "Reopened." } : r;
      break;
    }
    default:
      return { ok: false, message: "Unknown command." };
  }
  if (!res.ok) return failed(res as Fail);
  revalidatePath("/app", "layout");
  return res;
}

export async function addNoteAction(key: EntityKey, id: string, body: string): Promise<CmdResult> {
  if (!isKey(key)) return { ok: false, message: "Unknown record type." };
  const res = await addNote(await ctx(), { regardingType: key, regardingId: id, body });
  if (!res.ok) return failed(res);
  revalidatePath("/app", "layout");
  return { ok: true, message: "Note added." };
}

/** Typeahead for lookup fields. Only records the user can read are ever returned. */
export async function lookupAction(
  kind: "account" | "contact",
  q: string,
): Promise<{ id: string; label: string }[]> {
  const c = await ctx();
  if (kind === "account") {
    const r = await listAccounts(c, { search: q, limit: 8 });
    return r.ok ? r.rows.map((a) => ({ id: a.id, label: `${a.name} (${a.accountNumber})` })) : [];
  }
  const r = await listContacts(c, { search: q, limit: 8 });
  return r.ok
    ? r.rows.map((x) => ({
        id: x.id,
        label: `${[x.firstName, x.lastName].filter(Boolean).join(" ")} (${x.contactNumber})`,
      }))
    : [];
}

/** First step of the CSV import screen: read the header and suggest a column mapping. */
export async function previewImportAction(
  csv: string,
): Promise<
  | { ok: true; headers: string[]; sample: string[][]; mapping: ColumnMapping; rows: number }
  | { ok: false; message: string }
> {
  await ctx();
  try {
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      return { ok: false, message: "The file needs a header row and at least one data row." };
    }
    return {
      ok: true,
      headers: rows[0]!,
      sample: rows.slice(1, 4),
      mapping: suggestMapping(rows[0]!),
      rows: rows.length - 1,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "That file isn't valid CSV.",
    };
  }
}

export async function importLeadsAction(csv: string, mapping: ColumnMapping) {
  const res = await importLeads(await ctx(), csv, mapping);
  if (!res.ok) return { ok: false as const, message: res.message };
  revalidatePath("/app", "layout");
  return { ok: true as const, report: res.report };
}
