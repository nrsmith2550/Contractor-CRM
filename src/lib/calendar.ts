import { utcToZonedInput, zonedToUtc } from "./tz";

// Calendar helpers. The server sends FullCalendar *wall-clock* times in the business's zone
// ("2030-05-01T09:00:00", no offset) and the calendar is told its time zone is UTC, so it shows
// them exactly as written and no browser or library time-zone handling can shift an event.
// These functions convert between that and real instants.

/** A UTC instant as wall-clock text in the zone, to the second: "2030-05-01T09:00:00". */
export const wallClock = (at: Date, tz: string): string => `${utcToZonedInput(at, tz)}:00`;

/**
 * The instant for text from the calendar (a selection or a visible range), which is wall-clock in
 * the business's zone. Accepts "2030-05-01T09:00", "...:00" and a trailing "Z" or offset (ignored:
 * in UTC mode they only mean "no shift"). Date-only text means midnight.
 */
export function fromWallClock(text: unknown, tz: string): Date | null {
  if (typeof text !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(text);
  if (!m) return null;
  return zonedToUtc(`${m[1]}T${m[2] ?? "00:00"}`, tz);
}

/** The visible range FullCalendar asks for, as UTC instants; null if it isn't a sane range. */
export function rangeFromCalendar(
  start: unknown,
  end: unknown,
  tz: string,
): { from: Date; to: Date } | null {
  const from = fromWallClock(start, tz);
  const to = fromWallClock(end, tz);
  if (!from || !to || to <= from) return null;
  if (to.getTime() - from.getTime() > 100 * 86_400_000) return null; // a month view plus padding, never years
  return { from, to };
}

const SLUG: Record<string, string> = {
  lead: "prospects",
  account: "customers",
  contact: "people",
  opportunity: "deals",
  quote: "quotes",
  case: "support-requests",
  work_order: "jobs",
};

/** The page for a record an activity is about, or null for a type with no page. */
export const recordHref = (
  type: string | null | undefined,
  id: string | null | undefined,
): string | null => (type && id && SLUG[type] ? `/app/${SLUG[type]}/${id}` : null);
