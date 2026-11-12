import { parseCsv } from "@/lib/csv";
import { can } from "@/server/security/roles";
import { FORBIDDEN, fail, type Ctx, type Result } from "./context";
import { createLead } from "./leads";

export const MAX_IMPORT_ROWS = 5000;

/** Lead fields a CSV column can be mapped to. `estValue` is in dollars and stored as cents. */
export const IMPORT_FIELDS = [
  "topic",
  "firstName",
  "lastName",
  "jobTitle",
  "companyName",
  "email",
  "phone",
  "leadSource",
  "rating",
  "estValue",
  "addressStreet",
  "addressCity",
  "addressRegion",
  "addressPostalCode",
  "addressCountry",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, number>>;

const SYNONYMS: Record<ImportField, string[]> = {
  topic: ["topic", "subject", "leadname"],
  firstName: ["firstname", "first", "givenname", "forename"],
  lastName: ["lastname", "last", "surname", "familyname"],
  jobTitle: ["jobtitle", "title", "position", "role"],
  companyName: ["company", "companyname", "organization", "organisation", "business"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "phonenumber", "telephone", "mobile", "tel"],
  leadSource: ["leadsource", "source"],
  rating: ["rating", "temperature"],
  estValue: ["estvalue", "estimatedvalue", "value", "estrevenue", "dealvalue"],
  addressStreet: ["street", "address", "addressstreet", "address1"],
  addressCity: ["city", "town"],
  addressRegion: ["state", "region", "province", "addressregion"],
  addressPostalCode: ["zip", "zipcode", "postalcode", "postcode"],
  addressCountry: ["country"],
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Guesses which column holds which field from the header row, so the user only fixes exceptions. */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    const idx = headers.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(key(h)));
    if (idx >= 0) {
      mapping[field] = idx;
      used.add(idx);
    }
  }
  return mapping;
}

/** "$12,500.50" → 1250050. Returns null for blanks, undefined for something that isn't a number. */
export function parseMoneyToCents(raw: string): number | null | undefined {
  const s = raw.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  return Math.round(Number(s) * 100);
}

export type ImportReport = {
  total: number;
  created: number;
  errors: { row: number; message: string }[];
};

/**
 * Imports leads from CSV text. Each row goes through the same createLead path as a hand-entered
 * lead (validation, numbering, ownership, audit). Rows are independent: a bad row is reported
 * with its spreadsheet row number and the rest are still imported.
 */
export async function importLeads(
  ctx: Ctx,
  csvText: string,
  mapping: ColumnMapping,
  opts: { hasHeader?: boolean } = {},
): Promise<Result<{ report: ImportReport }>> {
  if (!can(ctx.subject, "lead", "create")) return FORBIDDEN;
  if (mapping.lastName === undefined) return fail("invalid", "Map a column to Last name.");

  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (err) {
    return fail("invalid", err instanceof Error ? err.message : "That file isn't valid CSV.");
  }
  const hasHeader = opts.hasHeader ?? true;
  const offset = hasHeader ? 2 : 1; // spreadsheet row number of rows[0]
  const data = hasHeader ? rows.slice(1) : rows;
  if (data.length > MAX_IMPORT_ROWS) {
    return fail(
      "invalid",
      `That file has ${data.length} rows; the limit is ${MAX_IMPORT_ROWS} per import.`,
    );
  }

  const report: ImportReport = { total: data.length, created: 0, errors: [] };
  for (const [i, cells] of data.entries()) {
    const rowNumber = i + offset;
    const input: Record<string, unknown> = {};
    for (const field of IMPORT_FIELDS) {
      const col = mapping[field];
      if (col === undefined) continue;
      const cell = (cells[col] ?? "").trim();
      if (field === "estValue") {
        const cents = parseMoneyToCents(cell);
        if (cents === undefined) {
          report.errors.push({ row: rowNumber, message: `"${cell}" isn't a valid amount.` });
          input.__bad = true;
        } else if (cents !== null) input.estValueCents = cents;
      } else if (field === "leadSource" || field === "rating") {
        input[field] = cell.toLowerCase().replace(/[\s-]+/g, "_");
      } else {
        input[field] = cell;
      }
    }
    if (input.__bad) continue;
    const res = await createLead(ctx, input);
    if (res.ok) report.created++;
    else report.errors.push({ row: rowNumber, message: res.message });
  }
  return { ok: true, report };
}
