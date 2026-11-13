import { zonedToUtc } from "./tz";
import { localDate } from "./board";

// Date windows for the dashboards, worked out in the business's time zone.

const pad = (n: number) => String(n).padStart(2, "0");

/** The calendar quarter containing `now` in the zone: its dates (inclusive start, exclusive end) and UTC instants. */
export function quarterRange(now: Date, tz: string) {
  const [y, m] = localDate(now, tz).split("-").map(Number) as [number, number];
  const startMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const endY = startMonth + 3 > 12 ? y + 1 : y;
  const endMonth = ((startMonth + 2) % 12) + 1;
  const startDate = `${y}-${pad(startMonth)}-01`;
  const endDate = `${endY}-${pad(endMonth)}-01`;
  return {
    label: `Q${(startMonth - 1) / 3 + 1} ${y}`,
    startDate,
    endDate,
    start: zonedToUtc(`${startDate}T00:00`, tz)!,
    end: zonedToUtc(`${endDate}T00:00`, tz)!,
  };
}

/** Today in the zone, as UTC instants (a 23 or 25 hour span on a daylight-saving change). */
export function dayRange(now: Date, tz: string) {
  const date = localDate(now, tz);
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  return {
    date,
    start: zonedToUtc(`${date}T00:00`, tz)!,
    end: zonedToUtc(`${nextDate}T00:00`, tz)!,
  };
}
