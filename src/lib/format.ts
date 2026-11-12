// Display formatting. Money is integer cents; timestamps are UTC and shown in the tenant's zone.
export const formatMoney = (cents: unknown, currency = "USD"): string =>
  typeof cents === "number"
    ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100)
    : "";

export const formatDate = (v: unknown, timeZone = "UTC"): string => {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  // Date-only values (YYYY-MM-DD) are calendar dates, not instants: don't shift them.
  const dateOnly = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    ...(dateOnly ? { timeZone: "UTC" } : { timeZone }),
  }).format(d);
};

export const formatDateTime = (v: Date, timeZone = "UTC"): string =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(v);

export const humanize = (v: string): string =>
  v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
