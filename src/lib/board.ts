import { utcToZonedInput, zonedToUtc } from "./tz";

// Schedule board geometry. The board has one linear time axis: a visible range [start, end) is
// laid out left to right at a fixed number of pixels per hour, and everything (blocks, drops,
// resizes) is converted between pixels and instants here, so the UI components stay thin. Pure
// functions, tested without a browser.

export type BoardView = "day" | "week" | "month";
export const BOARD_VIEWS: BoardView[] = ["day", "week", "month"];

/** Pixels per hour, and the grid a drag snaps to, for each view. */
export const SCALE: Record<BoardView, { pxPerHour: number; snapMinutes: number }> = {
  day: { pxPerHour: 64, snapMinutes: 15 },
  week: { pxPerHour: 8, snapMinutes: 30 },
  month: { pxPerHour: 2, snapMinutes: 60 },
};

export type Tick = { at: Date; label: string; major: boolean };
export type BoardRange = {
  view: BoardView;
  start: Date;
  end: Date;
  ticks: Tick[];
  pxPerHour: number;
  snapMinutes: number;
  widthPx: number;
};

const MS_PER_HOUR = 3_600_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (date: string, n: number): string =>
  new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n))
    .toISOString()
    .slice(0, 10);
const dayStart = (date: string, tz: string): Date => zonedToUtc(`${date}T00:00`, tz)!;

/** The local calendar date (YYYY-MM-DD) of an instant in a zone. */
export const localDate = (at: Date, tz: string): string => utcToZonedInput(at, tz).slice(0, 10);

/** Whether the text is a real calendar date. */
export const isDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * The visible range for a view around a date, in the business's zone. Day: that day. Week: the
 * Monday-to-Sunday week containing it. Month: the calendar month. Day lengths follow the zone,
 * so the day clocks change is 23 or 25 hours long and the axis stays truthful.
 */
export function boardRange(view: BoardView, date: string, tz: string): BoardRange {
  const [y, m, d] = [+date.slice(0, 4), +date.slice(5, 7), +date.slice(8, 10)];
  let first: string;
  let after: string; // the first date NOT in the range
  if (view === "day") {
    first = date;
    after = addDays(date, 1);
  } else if (view === "week") {
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
    first = addDays(date, -dow);
    after = addDays(first, 7);
  } else {
    first = `${date.slice(0, 7)}-01`;
    after = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  const start = dayStart(first, tz);
  const end = dayStart(after, tz);
  const { pxPerHour, snapMinutes } = SCALE[view];

  const ticks: Tick[] = [];
  if (view === "day") {
    // One tick per real hour of the day, labelled by the local hour. On a clock-change day this
    // gives 23 or 25 ticks (the repeated hour appears twice), never a tick for a missing hour.
    for (let t = start.getTime(); t < end.getTime(); t += MS_PER_HOUR) {
      const at = new Date(t);
      const h = Number(utcToZonedInput(at, tz).slice(11, 13));
      ticks.push({
        at,
        label: `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`,
        major: h % 6 === 0,
      });
    }
  } else {
    for (let day = first; day < after; day = addDays(day, 1)) {
      const [yy, mm, dd] = day.split("-").map(Number) as [number, number, number];
      const dow = new Date(Date.UTC(yy, mm - 1, dd)).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      });
      ticks.push({
        at: dayStart(day, tz),
        label: view === "week" ? `${dow} ${mm}/${dd}` : `${dd}`,
        major: dow === "Mon",
      });
    }
  }
  return {
    view,
    start,
    end,
    ticks,
    pxPerHour,
    snapMinutes,
    widthPx: ((end.getTime() - start.getTime()) / 3_600_000) * pxPerHour,
  };
}

/** Move the range by one view-unit: -1 for previous, +1 for next. Returns the new anchor date. */
export function shiftDate(view: BoardView, date: string, dir: -1 | 1): string {
  if (view === "day") return addDays(date, dir);
  if (view === "week") return addDays(date, 7 * dir);
  const y = +date.slice(0, 4);
  const m = +date.slice(5, 7);
  return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
}

/** x position (px) of an instant on the axis. May be outside [0, width] for instants off-screen. */
export const xFor = (at: Date, r: Pick<BoardRange, "start" | "pxPerHour">): number =>
  ((at.getTime() - r.start.getTime()) / MS_PER_HOUR) * r.pxPerHour;

/** The instant at an x position, snapped to the view's grid. */
export function timeAtX(
  x: number,
  r: Pick<BoardRange, "start" | "pxPerHour" | "snapMinutes">,
): Date {
  const ms = (x / r.pxPerHour) * MS_PER_HOUR;
  const snap = r.snapMinutes * 60_000;
  return new Date(r.start.getTime() + Math.round(ms / snap) * snap);
}

export type Block = { left: number; width: number };

/** The block for [start, end), clipped to the range (null when it is entirely outside). */
export function blockFor(start: Date, end: Date, r: BoardRange): Block | null {
  if (end <= r.start || start >= r.end) return null;
  const left = Math.max(0, xFor(start, r));
  const right = Math.min(r.widthPx, xFor(end, r));
  return { left, width: Math.max(right - left, 4) };
}

const clampDur = (ms: number, min: number) => Math.max(ms, min);

/** A booking dragged by `dx` pixels: same length, snapped start. */
export function moveByPixels(
  b: { start: Date; end: Date },
  dx: number,
  r: Pick<BoardRange, "pxPerHour" | "snapMinutes" | "start">,
): { start: Date; end: Date } {
  const snap = r.snapMinutes * 60_000;
  const deltaMs = Math.round(((dx / r.pxPerHour) * MS_PER_HOUR) / snap) * snap;
  return { start: new Date(b.start.getTime() + deltaMs), end: new Date(b.end.getTime() + deltaMs) };
}

/** A booking's end edge dragged by `dx` pixels: snapped, never shorter than one snap step. */
export function resizeEndByPixels(
  b: { start: Date; end: Date },
  dx: number,
  r: Pick<BoardRange, "pxPerHour" | "snapMinutes">,
): { start: Date; end: Date } {
  const snap = r.snapMinutes * 60_000;
  const deltaMs = Math.round(((dx / r.pxPerHour) * MS_PER_HOUR) / snap) * snap;
  return {
    start: b.start,
    end: new Date(
      b.start.getTime() + clampDur(b.end.getTime() - b.start.getTime() + deltaMs, snap),
    ),
  };
}

/** A booking's start edge dragged by `dx` pixels: snapped, never shorter than one snap step. */
export function resizeStartByPixels(
  b: { start: Date; end: Date },
  dx: number,
  r: Pick<BoardRange, "pxPerHour" | "snapMinutes">,
): { start: Date; end: Date } {
  const snap = r.snapMinutes * 60_000;
  const deltaMs = Math.round(((dx / r.pxPerHour) * MS_PER_HOUR) / snap) * snap;
  const start = Math.min(b.start.getTime() + deltaMs, b.end.getTime() - snap);
  return { start: new Date(start), end: b.end };
}

/**
 * Stacks overlapping blocks in a row into lanes, so none draws over another. Greedy interval
 * partitioning in start order; returns each item's lane and the row's lane count.
 */
export function layoutLanes<T extends { id: string; start: Date; end: Date }>(
  items: T[],
): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime(),
  );
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.start.getTime());
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = it.end.getTime();
    lanes.set(it.id, lane);
  }
  return { lanes, count: Math.max(laneEnds.length, 1) };
}

/** Which row (by index) a vertical position falls in, or -1. Rows have varying heights. */
export function rowAtY(y: number, heights: number[]): number {
  let top = 0;
  for (const [i, h] of heights.entries()) {
    if (y >= top && y < top + h) return i;
    top += h;
  }
  return -1;
}
