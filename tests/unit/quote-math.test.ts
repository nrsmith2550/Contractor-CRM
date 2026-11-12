import { describe, expect, it } from "vitest";
import { allocate, calculateQuote } from "@/server/domain/quote-math";

const line = (quantity: number, unitPriceCents: number, extra = {}) => ({
  quantity,
  unitPriceCents,
  ...extra,
});

describe("quote math", () => {
  it("handles an empty quote and zero quantity", () => {
    expect(calculateQuote([]).totalCents).toBe(0);
    const t = calculateQuote([line(0, 1999, { taxRateBp: 825 })], { freightCents: 500 });
    expect(t).toMatchObject({ subtotalCents: 0, taxCents: 0, totalCents: 500 });
  });

  it("computes subtotal, discount, freight and tax to the cent", () => {
    // 3 x $19.99 = $59.97; 10% off = $6.00 (5.997 rounds up); taxable base $53.97; 8.25% = $4.45 (4.4525)
    const t = calculateQuote([line(3, 1999, { taxRateBp: 825 })], {
      discount: { kind: "percent", bp: 1000 },
      freightCents: 1250,
    });
    expect(t.subtotalCents).toBe(5997);
    expect(t.discountCents).toBe(600);
    expect(t.taxCents).toBe(445);
    expect(t.totalCents).toBe(5997 - 600 + 1250 + 445);
  });

  it("a 100% discount leaves no tax and only freight", () => {
    const t = calculateQuote([line(2, 5000, { taxRateBp: 1000 })], {
      discount: { kind: "percent", bp: 10_000 },
      freightCents: 700,
    });
    expect(t).toMatchObject({
      subtotalCents: 10000,
      discountCents: 10000,
      taxCents: 0,
      totalCents: 700,
    });
  });

  it("caps a fixed discount at the subtotal and a line discount at the line amount", () => {
    expect(
      calculateQuote([line(1, 1000)], { discount: { kind: "amount", cents: 99_999 } }).totalCents,
    ).toBe(0);
    const t = calculateQuote([line(1, 1000, { discountCents: 5000 }), line(1, 300)]);
    expect(t.lines[0]!.extendedCents).toBe(0);
    expect(t.subtotalCents).toBe(300);
  });

  it("rounds half up on fractional quantities", () => {
    // 0.5 x $0.01 = 0.005 cents -> 1 cent; 2.5 x $1.01 = 252.5 -> 253
    expect(calculateQuote([line(0.5, 1)]).subtotalCents).toBe(1);
    expect(calculateQuote([line(2.5, 101)]).subtotalCents).toBe(253);
  });

  it("allocates the discount so per-line tax adds up and lines sum to the totals", () => {
    const lines = [
      line(1, 3333, { taxRateBp: 700 }),
      line(1, 3333, { taxRateBp: 700 }),
      line(1, 3334),
    ];
    const t = calculateQuote(lines, { discount: { kind: "amount", cents: 100 } });
    expect(t.lines.reduce((s, l) => s + l.extendedCents, 0)).toBe(t.subtotalCents);
    expect(t.lines.reduce((s, l) => s + l.discountedBaseCents, 0)).toBe(
      t.subtotalCents - t.discountCents,
    );
    expect(t.lines.reduce((s, l) => s + l.taxCents, 0)).toBe(t.taxCents);
    expect(t.totalCents).toBe(t.subtotalCents - t.discountCents + t.taxCents);
  });

  it("stays exact for very large amounts (no floating point)", () => {
    const t = calculateQuote([line(1_000_000, 9_000_000_000, { taxRateBp: 1 })]);
    expect(t.subtotalCents).toBe(9_000_000_000_000_000);
    expect(Number.isSafeInteger(t.totalCents)).toBe(true);
  });

  it("rejects invalid inputs", () => {
    expect(() => calculateQuote([line(-1, 100)])).toThrow(RangeError);
    expect(() => calculateQuote([line(1, 10.5)])).toThrow(RangeError);
    expect(() =>
      calculateQuote([line(1, 100)], { discount: { kind: "percent", bp: 10_001 } }),
    ).toThrow(RangeError);
    expect(() => calculateQuote([line(1, 100)], { freightCents: -1 })).toThrow(RangeError);
  });
});

describe("allocate", () => {
  it("splits exactly using largest remainder", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
    const parts = allocate(997, [333, 333, 334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(997);
  });
});
