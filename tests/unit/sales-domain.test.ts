import { describe, expect, it } from "vitest";
import { parseCsv, sanitizeCell, toCsv } from "@/lib/csv";
import { diffChanges } from "@/server/domain/audit";
import {
  STAGES,
  canMove,
  missingFields,
  nextStage,
  type OpportunitySnapshot,
} from "@/server/domain/bpf";
import { normalizeName, normalizePhone } from "@/server/domain/duplicates";
import { parseMoneyToCents, suggestMapping } from "@/server/domain/lead-import";

const empty: OpportunitySnapshot = {
  name: "Deal",
  customerAccountId: null,
  customerContactId: null,
  estCloseDate: null,
  estRevenueCents: 0,
  budgetCents: null,
  purchaseTimeframe: null,
  proposalDelivered: false,
};
const labels = (o: OpportunitySnapshot, stage: "qualify" | "develop" | "propose" | "close") =>
  missingFields(o, stage).map((m) => m.label);

describe("business process flow", () => {
  it("has the four Dynamics stages in order", () => {
    expect(STAGES).toEqual(["qualify", "develop", "propose", "close"]);
    expect(nextStage("qualify")).toBe("develop");
    expect(nextStage("close")).toBeNull();
  });

  it("each stage names the fields that must be filled before leaving it", () => {
    expect(labels(empty, "qualify")).toEqual(["Account", "Estimated close date"]);
    expect(labels(empty, "develop")).toEqual([
      "Decision-maker contact",
      "Budget",
      "Purchase timeframe",
    ]);
    expect(labels(empty, "propose")).toEqual(["Estimated revenue", "Proposal delivered"]);
    expect(labels(empty, "close")).toEqual([]);
    // Blank strings and zero don't count as filled in.
    expect(labels({ ...empty, name: "  " }, "qualify")).toContain("Topic");
    expect(labels({ ...empty, budgetCents: 0 }, "develop")).toContain("Budget");
  });

  it("advances one stage at a time, only with the required fields; going back is always allowed", () => {
    const ready: OpportunitySnapshot = {
      ...empty,
      customerAccountId: "a",
      estCloseDate: "2026-12-31",
      customerContactId: "c",
      budgetCents: 100,
      purchaseTimeframe: "Q1",
      estRevenueCents: 5000,
      proposalDelivered: true,
    };
    expect(canMove(empty, "qualify", "develop")).toMatchObject({
      ok: false,
      reason: "missing_fields",
      missing: [{ label: "Account" }, { label: "Estimated close date" }],
    });
    expect(canMove(ready, "qualify", "develop")).toEqual({ ok: true });
    expect(canMove(ready, "qualify", "propose")).toMatchObject({ ok: false, reason: "skip" });
    expect(canMove(ready, "develop", "develop")).toMatchObject({ ok: false, reason: "same" });
    expect(canMove(empty, "propose", "qualify")).toEqual({ ok: true });
    expect(canMove(empty, "close", "develop")).toEqual({ ok: true });
    expect(canMove(ready, "propose", "close")).toEqual({ ok: true });
    expect(canMove(empty, "propose", "close")).toMatchObject({
      ok: false,
      reason: "missing_fields",
    });
  });
});

describe("CSV", () => {
  it("parses quoted fields, embedded commas, quotes and newlines, and all line endings", () => {
    const text = 'a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\n\n1,,3\r';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'he said "hi"', "line1\nline2"],
      ["1", "", "3"],
    ]);
    expect(parseCsv("﻿name\nAda")).toEqual([["name"], ["Ada"]]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(() => parseCsv('a,"unterminated')).toThrow(/Unterminated/);
  });

  it("round-trips through toCsv", () => {
    const rows = [
      ["name", "note"],
      ["Ada, Countess", 'says "hello"\nthere'],
      ["", "plain"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("neutralises spreadsheet formulas on export but leaves numbers and normal text alone", () => {
    for (const evil of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) {
      expect(sanitizeCell(evil)).toBe(`'${evil}`);
    }
    expect(sanitizeCell(-42)).toBe("-42");
    expect(sanitizeCell("Acme")).toBe("Acme");
    expect(sanitizeCell(null)).toBe("");
    expect(toCsv([['=HYPERLINK("http://evil")']])).toBe('"\'=HYPERLINK(""http://evil"")"');
  });
});

describe("audit diff", () => {
  it("lists only fields whose value changed, with before and after", () => {
    const before = { a: 1, b: "x", c: null, d: new Date("2026-01-01T00:00:00Z") };
    const after = { a: 1, b: "y", c: "now", d: new Date("2026-01-01T00:00:00Z") };
    expect(diffChanges(before, after)).toEqual({
      b: { from: "x", to: "y" },
      c: { from: null, to: "now" },
    });
    expect(diffChanges({ a: undefined }, { a: null })).toEqual({});
    expect(diffChanges({ a: 1, b: 2 }, { a: 9, b: 9 }, ["a"])).toEqual({ a: { from: 1, to: 9 } });
  });
});

describe("duplicate-matching normalisation", () => {
  it("compares phones by their last 10 digits", () => {
    expect(normalizePhone("+1 (412) 555-0100")).toBe("4125550100");
    expect(normalizePhone("412.555.0100")).toBe("4125550100");
    expect(normalizePhone("555-0100")).toBe("5550100");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("compares names ignoring case, punctuation and spacing", () => {
    expect(normalizeName("Acme, Inc.")).toBe("acme inc");
    expect(normalizeName("  ACME   inc ")).toBe("acme inc");
    expect(normalizeName("   ")).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
  });
});

describe("lead import helpers", () => {
  it("guesses the column mapping from common header names", () => {
    const m = suggestMapping([
      "First Name",
      "Surname",
      "Company",
      "E-mail",
      "Phone Number",
      "Lead Source",
      "Estimated Value",
      "ZIP",
      "Notes",
    ]);
    expect(m).toMatchObject({
      firstName: 0,
      lastName: 1,
      companyName: 2,
      email: 3,
      phone: 4,
      leadSource: 5,
      estValue: 6,
      addressPostalCode: 7,
    });
    expect(Object.values(m)).not.toContain(8); // "Notes" is unmapped
    expect(suggestMapping(["Last", "Last Name"])).toMatchObject({ lastName: 0 }); // one column per field
  });

  it("parses dollar amounts into integer cents", () => {
    expect(parseMoneyToCents("$12,500.50")).toBe(1_250_050);
    expect(parseMoneyToCents("100")).toBe(10_000);
    expect(parseMoneyToCents("0.1")).toBe(10);
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeUndefined();
    expect(parseMoneyToCents("-5")).toBeUndefined();
    expect(parseMoneyToCents("1.234")).toBeUndefined();
  });
});
