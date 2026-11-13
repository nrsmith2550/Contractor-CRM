import { withTenant } from "@/db/client";
import type { EntityMeta } from "@/entities/types";
import { humanize } from "@/lib/format";
import { utcToZonedInput } from "@/lib/tz";
import type { Cell, Sheet } from "@/lib/xlsx";
import { recordAudit } from "@/server/domain/audit";
import { fail, type Ctx, type Result } from "@/server/domain/context";
import { slaInfo } from "@/server/domain/sla";
import { OPS, type Row } from "./registry";

/** More than this and the person is asked to narrow the view: a spreadsheet that silently stops is worse. */
export const EXPORT_LIMIT = 10_000;
const PAGE = 200; // the most one list call returns

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cell(col: EntityMeta["columns"][number], row: Row, tz: string): Cell {
  const v = row[col.name];
  if (v === null || v === undefined || v === "") return null;
  if (col.type === "money") return { kind: "money", cents: Number(v) };
  if (col.type === "date") {
    if (typeof v === "string" && ISO_DATE.test(v)) return { kind: "date", value: v };
    const at = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(at.getTime())
      ? String(v)
      : { kind: "date", value: utcToZonedInput(at, tz).slice(0, 10) };
  }
  if (col.type === "sla") {
    const info = slaInfo({
      status: String(row.status),
      createdAt: row.createdAt as Date,
      slaDueAt: (row.slaDueAt as Date | null) ?? null,
      resolvedAt: (row.resolvedAt as Date | null) ?? null,
    });
    return humanize(info.state);
  }
  if (col.type === "badge") return humanize(String(v));
  return String(v);
}

/**
 * Every record in a view (not just the page on screen), as a table with the grid's columns.
 * It goes through the same list function as the screen, so the user only ever gets what they may
 * read. Each export is written to the audit log, because it is a bulk copy of customer data.
 */
export async function exportEntity(
  ctx: Ctx,
  meta: EntityMeta,
  opts: { view: string; search: string; tz: string; format: string; limit?: number },
): Promise<Result<{ sheet: Sheet; count: number }>> {
  const cap = opts.limit ?? EXPORT_LIMIT;
  const rows: Row[] = [];
  let total = 0;
  for (let offset = 0; ; offset += PAGE) {
    const r = await OPS[meta.key].list(ctx, {
      view: opts.view,
      search: opts.search,
      limit: PAGE,
      offset,
    });
    if (!r.ok) return r;
    total = r.total;
    if (total > cap) {
      return fail(
        "invalid",
        `That's ${total.toLocaleString("en-US")} records. Narrow the view or search to ${cap.toLocaleString("en-US")} or fewer and try again.`,
      );
    }
    rows.push(...r.rows);
    if (r.rows.length < PAGE || rows.length >= total) break;
  }

  await withTenant(ctx.tenantId, (tx) =>
    recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: meta.key,
      action: "export",
      changes: { view: opts.view, search: opts.search, format: opts.format, records: rows.length },
    }),
  );

  return {
    ok: true,
    count: rows.length,
    sheet: {
      name: meta.plural,
      headers: meta.columns.map((c) => c.label),
      rows: rows.map((r) => meta.columns.map((c) => cell(c, r, opts.tz))),
    },
  };
}
