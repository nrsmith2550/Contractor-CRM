// Quote totals. Pure functions, integer cents throughout (no floating point in money math).
//
// Order of operations, matching the quote builder's totals panel:
//   line extended = quantity x unit price - line discount           (never below 0)
//   subtotal      = sum of line extended amounts
//   quote discount= percent of subtotal OR a fixed amount (capped at the subtotal)
//   tax           = per line, on that line's extended amount less its share of the quote discount
//   total         = subtotal - quote discount + freight + tax
// Freight is not taxed. Rounding is half-up on every division so results are reproducible.

export type LineInput = {
  /** Up to 3 decimal places (e.g. 2.5 hours). Must be >= 0. */
  quantity: number;
  unitPriceCents: number;
  /** Discount for the whole line, in cents. */
  discountCents?: number;
  /** Tax rate in basis points: 825 = 8.25%. Omit or 0 for untaxed. */
  taxRateBp?: number;
};

export type QuoteDiscount =
  | { kind: "none" }
  | { kind: "percent"; bp: number } // 1000 = 10%
  | { kind: "amount"; cents: number };

export type LineTotals = { extendedCents: number; discountedBaseCents: number; taxCents: number };
export type QuoteTotals = {
  lines: LineTotals[];
  subtotalCents: number;
  discountCents: number;
  freightCents: number;
  taxCents: number;
  totalCents: number;
};

/** round-half-up(a * b / d) for non-negative integers, exact even for very large values. */
function mulDiv(a: number, b: number, d: number): number {
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(d);
  return Number((num * 2n + den) / (den * 2n));
}

const isCents = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function calculateQuote(
  lines: LineInput[],
  opts: { discount?: QuoteDiscount; freightCents?: number } = {},
): QuoteTotals {
  const freightCents = opts.freightCents ?? 0;
  if (!isCents(freightCents))
    throw new RangeError("Freight must be a non-negative whole number of cents");

  const extended = lines.map((l, i) => {
    const qtyMilli = Math.round(l.quantity * 1000);
    if (!Number.isFinite(l.quantity) || qtyMilli < 0)
      throw new RangeError(`Line ${i + 1}: invalid quantity`);
    if (!isCents(l.unitPriceCents)) throw new RangeError(`Line ${i + 1}: invalid unit price`);
    const discount = l.discountCents ?? 0;
    if (!isCents(discount)) throw new RangeError(`Line ${i + 1}: invalid discount`);
    const rate = l.taxRateBp ?? 0;
    if (!Number.isInteger(rate) || rate < 0 || rate > 100_000)
      throw new RangeError(`Line ${i + 1}: invalid tax rate`);
    const gross = mulDiv(qtyMilli, l.unitPriceCents, 1000);
    return Math.max(0, gross - discount);
  });

  const subtotalCents = extended.reduce((s, n) => s + n, 0);

  const d = opts.discount ?? { kind: "none" };
  let discountCents = 0;
  if (d.kind === "percent") {
    if (!Number.isInteger(d.bp) || d.bp < 0 || d.bp > 10_000)
      throw new RangeError("Discount percent must be 0-100%");
    discountCents = mulDiv(subtotalCents, d.bp, 10_000);
  } else if (d.kind === "amount") {
    if (!isCents(d.cents))
      throw new RangeError("Discount amount must be a non-negative whole number of cents");
    discountCents = Math.min(d.cents, subtotalCents);
  }

  // Share the quote discount across lines in proportion to their amounts (largest remainder, so
  // the shares add up to exactly the discount), because tax is computed on what's actually charged.
  const shares = allocate(discountCents, extended);

  const out: LineTotals[] = extended.map((extendedCents, i) => {
    const discountedBaseCents = extendedCents - shares[i]!;
    const taxCents = mulDiv(discountedBaseCents, lines[i]!.taxRateBp ?? 0, 10_000);
    return { extendedCents, discountedBaseCents, taxCents };
  });
  const taxCents = out.reduce((s, l) => s + l.taxCents, 0);

  return {
    lines: out,
    subtotalCents,
    discountCents,
    freightCents,
    taxCents,
    totalCents: subtotalCents - discountCents + freightCents + taxCents,
  };
}

/** Split `amount` across `weights` proportionally using the largest-remainder method. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const base = weights.map((w) => Number((BigInt(amount) * BigInt(w)) / BigInt(total)));
  const rem = weights.map((w, i) => ({
    i,
    r: (BigInt(amount) * BigInt(w)) % BigInt(total),
  }));
  let left = amount - base.reduce((s, n) => s + n, 0);
  rem.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of rem) {
    if (left <= 0) break;
    base[i]! += 1;
    left -= 1;
  }
  return base;
}

/** Cost of parts: quantity (in thousandths) x unit price, rounded half-up to the cent. */
export function partAmountCents(quantityMilli: number, unitPriceCents: number): number {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0)
    throw new RangeError("Invalid quantity");
  if (!isCents(unitPriceCents)) throw new RangeError("Invalid unit price");
  return mulDiv(quantityMilli, unitPriceCents, 1000);
}

/** Cost of labour: minutes x hourly rate / 60, rounded half-up to the cent. */
export function labourAmountCents(minutes: number, hourlyRateCents: number): number {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError("Invalid minutes");
  if (!isCents(hourlyRateCents)) throw new RangeError("Invalid hourly rate");
  return mulDiv(minutes, hourlyRateCents, 60);
}
