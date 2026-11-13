import { toCsv } from "./csv";
import { zipStored } from "./zip";

// A small, dependency-free .xlsx (Excel workbook) writer: one sheet, a bold frozen header row,
// real numbers, money and dates (so they sort and sum in Excel). Text goes in as inline strings,
// which a spreadsheet never evaluates as a formula.

export type Cell =
  | string
  | number
  | null
  | undefined
  | { kind: "money"; cents: number }
  | { kind: "date"; value: string } // YYYY-MM-DD
  | { kind: "datetime"; value: string }; // YYYY-MM-DDTHH:mm, already in the business's zone

export type Sheet = { name: string; headers: string[]; rows: Cell[][] };

// Excel forbids these characters in sheet names; names are limited to 31 characters.
const sheetName = (s: string) =>
  s
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31) || "Sheet1";

// XML 1.0 can't carry most control characters, so drop them.
const xmlText = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Column letters: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel's day number (1900 system) for a date, with the time of day as a fraction. */
export function excelSerial(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h = "0", mi = "0"] = m.slice(1);
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(ms) || new Date(ms).getUTCDate() !== Number(d)) return null;
  const days = ms / 86_400_000 + 25569; // 1970-01-01 is day 25569
  return days + (Number(h) * 60 + Number(mi)) / 1440;
}

// Cell styles (indexes into cellXfs below).
const S_HEADER = 1;
const S_MONEY = 2;
const S_DATE = 3;
const S_DATETIME = 4;

function cellXml(ref: string, c: Cell): string {
  if (c === null || c === undefined || c === "") return "";
  if (typeof c === "number") return Number.isFinite(c) ? `<c r="${ref}"><v>${c}</v></c>` : "";
  if (typeof c === "string") {
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(c)}</t></is></c>`;
  }
  if (c.kind === "money") {
    return Number.isFinite(c.cents)
      ? `<c r="${ref}" s="${S_MONEY}"><v>${c.cents / 100}</v></c>`
      : "";
  }
  const serial = excelSerial(c.value);
  if (serial === null) {
    return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(c.value)}</t></is></c>`;
  }
  return `<c r="${ref}" s="${c.kind === "date" ? S_DATE : S_DATETIME}"><v>${serial}</v></c>`;
}

const width = (header: string, rows: Cell[][], col: number) => {
  let w = header.length;
  for (const r of rows.slice(0, 200)) {
    const c = r[col];
    const len =
      typeof c === "string"
        ? c.length
        : c && typeof c === "object"
          ? c.kind === "money"
            ? 12
            : 16
          : typeof c === "number"
            ? String(c).length
            : 0;
    if (len > w) w = len;
  }
  return Math.min(Math.max(w + 2, 8), 60);
};

export function buildXlsx(sheet: Sheet): Uint8Array {
  const last = Math.max(sheet.headers.length - 1, 0);
  const cols = sheet.headers
    .map(
      (h, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${width(h, sheet.rows, i)}" customWidth="1"/>`,
    )
    .join("");
  const head = `<row r="1">${sheet.headers
    .map(
      (h, i) =>
        `<c r="${columnName(i)}1" s="${S_HEADER}" t="inlineStr"><is><t>${xmlText(h)}</t></is></c>`,
    )
    .join("")}</row>`;
  const body = sheet.rows
    .map(
      (r, ri) =>
        `<row r="${ri + 2}">${r.map((c, ci) => cellXml(`${columnName(ci)}${ri + 2}`, c)).join("")}</row>`,
    )
    .join("");

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${columnName(last)}${sheet.rows.length + 1}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${columnName(last)}${sheet.rows.length + 1}"/></worksheet>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="5">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const name = xmlText(sheetName(sheet.name));
  return zipStored([
    {
      name: "[Content_Types].xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ]);
}

/** The same table as CSV (with a BOM so Excel reads UTF-8), numbers as plain amounts and ISO dates. */
export function buildCsv(sheet: Sheet): string {
  const plain = (c: Cell): unknown =>
    c && typeof c === "object"
      ? c.kind === "money"
        ? (c.cents / 100).toFixed(2)
        : c.value.replace("T", " ")
      : c;
  return "﻿" + toCsv([sheet.headers, ...sheet.rows.map((r) => r.map(plain))]);
}
