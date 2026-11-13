import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildCsv, buildXlsx, columnName, excelSerial } from "@/lib/xlsx";
import { crc32, zipStored } from "@/lib/zip";

/** Reads a stored zip back through its central directory, checking each CRC. */
function unzip(bytes: Uint8Array): Record<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    let data = bytes.subarray(dataStart, dataStart + size);
    if (method === 8) data = inflateRawSync(data);
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    p += 46 + nameLen;
  }
  return out;
}

describe("zip", () => {
  it("has the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("round-trips files, including non-ASCII names and empty files", () => {
    const files = unzip(
      zipStored([
        { name: "a.txt", data: "hello" },
        { name: "dir/é.txt", data: "wörld" },
        { name: "empty", data: "" },
      ]),
    );
    expect(files).toEqual({ "a.txt": "hello", "dir/é.txt": "wörld", empty: "" });
  });
  it("is deterministic", () => {
    const f = [{ name: "a", data: "x" }];
    expect(zipStored(f)).toEqual(zipStored(f));
  });
});

describe("xlsx helpers", () => {
  it("names columns like a spreadsheet", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      "A",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });
  it("converts dates to Excel day numbers", () => {
    expect(excelSerial("1970-01-01")).toBe(25569);
    expect(excelSerial("2030-05-01")).toBe(47604);
    expect(excelSerial("2030-05-01T12:00")).toBe(47604.5);
    expect(excelSerial("2030-02-30")).toBeNull();
    expect(excelSerial("soon")).toBeNull();
  });
});

describe("buildXlsx", () => {
  const sheet = {
    name: "Leads: Q2/2030 with a name that is far too long to fit",
    headers: ["Name", "Value", "Created", "At", "Note"],
    rows: [
      [
        "Ann & <Bob>",
        { kind: "money" as const, cents: 123456 },
        { kind: "date" as const, value: "2030-05-01" },
        { kind: "datetime" as const, value: "2030-05-01T09:30" },
        '=HYPERLINK("http://evil")',
      ],
      ["Zoë\u0001", null, undefined, { kind: "date" as const, value: "not a date" }, 42],
    ],
  };
  const files = unzip(buildXlsx(sheet));

  it("contains the parts Excel needs", () => {
    expect(Object.keys(files).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
  });
  it("cleans the sheet name", () => {
    const name = /<sheet name="([^"]*)"/.exec(files["xl/workbook.xml"]!)![1]!;
    expect(name).not.toMatch(/[\\/?*[\]:]/);
    expect(name.length).toBeLessThanOrEqual(31);
  });
  it("writes real numbers and dates, and escapes text", () => {
    const x = files["xl/worksheets/sheet1.xml"]!;
    expect(x).toContain('<c r="B2" s="2"><v>1234.56</v></c>');
    expect(x).toContain('<c r="C2" s="3"><v>47604</v></c>');
    expect(x).toContain('<c r="D2" s="4"><v>47604.395833333336</v></c>');
    expect(x).toContain("Ann &amp; &lt;Bob&gt;");
    expect(x).toContain('<c r="E3"><v>42</v></c>');
    expect(x).toContain('<dimension ref="A1:E3"/>');
  });
  it("never turns text into a formula, and drops control characters", () => {
    const x = files["xl/worksheets/sheet1.xml"]!;
    expect(x).not.toContain("<f>");
    expect(x).toContain(
      't="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;http://evil&quot;)</t>',
    );
    expect(x).toContain("Zoë</t>");
    expect(x).not.toContain("\u0001");
  });
  it("leaves empty cells out and keeps an unparseable date as text", () => {
    const x = files["xl/worksheets/sheet1.xml"]!;
    expect(x).not.toContain('r="B3"');
    expect(x).not.toContain('r="C3"');
    expect(x).toContain("not a date");
  });
  it("handles an empty sheet", () => {
    const f = unzip(buildXlsx({ name: "Empty", headers: ["A"], rows: [] }));
    expect(f["xl/worksheets/sheet1.xml"]).toContain('<dimension ref="A1:A1"/>');
  });
});

describe("buildCsv", () => {
  it("writes plain amounts and dates, guards formulas, and starts with a BOM", () => {
    const csv = buildCsv({
      name: "x",
      headers: ["Name", "Value", "On", "At"],
      rows: [
        [
          "=1+1",
          { kind: "money", cents: 5 },
          { kind: "date", value: "2030-05-01" },
          { kind: "datetime", value: "2030-05-01T09:30" },
        ],
      ],
    });
    expect(csv).toBe("﻿Name,Value,On,At\r\n'=1+1,0.05,2030-05-01,2030-05-01 09:30");
  });
});
