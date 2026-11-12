// Time zones. Timestamps are stored in UTC and shown/entered in the business's zone. A
// <input type="datetime-local"> value is a "wall clock" string ("2030-05-01T09:30") with no zone,
// so these convert between that and a UTC instant for a given IANA zone, handling DST.

/** The zone's offset from UTC, in minutes, at the given instant (e.g. -240 for New York in summer). */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * "2030-05-01T09:30" in `timeZone` -> the UTC instant. Returns null if the text isn't a wall-clock
 * time. A time that doesn't exist (the hour skipped when clocks go forward) is moved forward by
 * that hour; an ambiguous one (the hour repeated when clocks go back) takes the first occurrence.
 */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = WALL.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (new Date(naive).getUTCMonth() !== mo - 1) return null; // e.g. 2030-02-31
  // Guess using the offset at the naive instant, then correct once for a DST change in between.
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60_000;
  const corrected = naive - offsetMinutes(new Date(guess), timeZone) * 60_000;
  if (corrected !== guess) {
    // Near a transition the two disagree; prefer the earlier instant when the time repeats.
    const earlier = Math.min(guess, corrected);
    const later = Math.max(guess, corrected);
    guess =
      offsetMinutes(new Date(earlier), timeZone) === offsetMinutes(new Date(later), timeZone)
        ? corrected
        : earlier;
    if (utcToZonedInput(new Date(guess), timeZone) !== local) guess = later; // a skipped time: move forward
  }
  return new Date(guess);
}

/** A UTC instant -> "YYYY-MM-DDTHH:mm" wall-clock text in `timeZone`, for a datetime-local input. */
export function utcToZonedInput(at: Date | string, timeZone: string): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
