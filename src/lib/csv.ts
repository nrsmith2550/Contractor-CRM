// Small, dependency-free CSV reader/writer (RFC 4180: quoted fields, doubled quotes, embedded
// commas and newlines, CRLF/LF/CR line endings, optional BOM).

export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let sawAnything = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip lines that are completely empty (a single empty field).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    sawAnything = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    sawAnything = true;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("Unterminated quoted field");
  if (sawAnything) endRow();
  return rows;
}

/**
 * Spreadsheet apps execute cells that start with = + - @ (or a tab/CR) as formulas, so exported
 * text that begins with one of those is prefixed with an apostrophe. Numbers are left alone.
 */
export function sanitizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = sanitizeCell(cell);
          return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}
