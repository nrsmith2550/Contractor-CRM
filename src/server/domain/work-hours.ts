import { z } from "zod";
import { utcToZonedInput } from "@/lib/tz";

// A resource's weekly working hours, in the business's time zone: for each weekday, up to three
// intervals of "HH:MM" local times. Pure functions so the rules are easy to test.

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WorkHours = Record<Weekday, { start: string; end: string }[]>;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

const interval = z
  .object({
    start: z.string().regex(HHMM, "Use HH:MM, e.g. 08:00"),
    end: z.string().regex(HHMM, "Use HH:MM, e.g. 17:00"),
  })
  .refine((i) => minutes(i.end) > minutes(i.start), {
    message: "An interval must end after it starts",
  });

const day = z
  .array(interval)
  .max(3, "At most three intervals a day")
  .refine(
    (list) => {
      const sorted = [...list].sort((a, b) => minutes(a.start) - minutes(b.start));
      return sorted.every((i, k) => k === 0 || minutes(i.start) >= minutes(sorted[k - 1]!.end));
    },
    { message: "Intervals in a day can't overlap" },
  );

export const workHoursSchema = z.object(
  Object.fromEntries(WEEKDAYS.map((d) => [d, day])) as Record<Weekday, typeof day>,
);

/** Monday to Friday, 08:00 to 17:00. */
export const defaultWorkHours = (): WorkHours => ({
  sun: [],
  mon: [{ start: "08:00", end: "17:00" }],
  tue: [{ start: "08:00", end: "17:00" }],
  wed: [{ start: "08:00", end: "17:00" }],
  thu: [{ start: "08:00", end: "17:00" }],
  fri: [{ start: "08:00", end: "17:00" }],
  sat: [],
});

/**
 * Whether [start, end) falls inside one working interval of a single local day. A booking that
 * crosses midnight, or spans a break between two intervals, is outside working hours.
 */
export function isWithinWorkHours(
  hours: WorkHours,
  start: Date,
  end: Date,
  timeZone: string,
): boolean {
  if (!(end > start)) return false;
  const a = utcToZonedInput(start, timeZone);
  const b = utcToZonedInput(end, timeZone);
  const dateA = a.slice(0, 10);
  if (dateA !== b.slice(0, 10)) {
    // Ending exactly at local midnight counts as the end of the same day.
    if (!(b.slice(11) === "00:00" && nextDay(dateA) === b.slice(0, 10))) return false;
  }
  const [y, m, d] = dateA.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  const from = minutes(a.slice(11));
  const to = dateA === b.slice(0, 10) ? minutes(b.slice(11)) : 24 * 60;
  return hours[weekday].some((i) => minutes(i.start) <= from && to <= minutes(i.end));
}

const nextDay = (date: string): string => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
