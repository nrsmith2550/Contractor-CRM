import { describe, expect, it } from "vitest";
import {
  SCALE,
  blockFor,
  boardRange,
  isDate,
  layoutLanes,
  localDate,
  moveByPixels,
  resizeEndByPixels,
  resizeStartByPixels,
  rowAtY,
  shiftDate,
  timeAtX,
  xFor,
} from "@/lib/board";
import { zonedToUtc } from "@/lib/tz";

const NY = "America/New_York";
const at = (s: string, tz = NY) => zonedToUtc(s, tz)!;
const iso = (d: Date) => d.toISOString();

describe("board ranges", () => {
  it("a day runs midnight to midnight in the zone, with hourly ticks", () => {
    const r = boardRange("day", "2030-05-01", NY);
    expect(iso(r.start)).toBe("2030-05-01T04:00:00.000Z");
    expect(iso(r.end)).toBe("2030-05-02T04:00:00.000Z");
    expect(r.ticks).toHaveLength(24);
    expect(r.ticks[9]!.label).toBe("9a");
    expect(r.ticks[0]!.label).toBe("12a");
    expect(r.ticks[12]!.label).toBe("12p");
    expect(r.widthPx).toBe(24 * SCALE.day.pxPerHour);
  });

  it("a week is Monday to Sunday containing the date", () => {
    const r = boardRange("week", "2030-05-01", NY); // a Wednesday
    expect(localDate(r.start, NY)).toBe("2030-04-29"); // Monday
    expect(localDate(new Date(r.end.getTime() - 1), NY)).toBe("2030-05-05"); // Sunday
    expect(r.ticks.map((t) => t.label)).toEqual([
      "Mon 4/29",
      "Tue 4/30",
      "Wed 5/1",
      "Thu 5/2",
      "Fri 5/3",
      "Sat 5/4",
      "Sun 5/5",
    ]);
    expect(r.ticks.filter((t) => t.major)).toHaveLength(1);
    expect(boardRange("week", "2030-04-29", NY).start).toEqual(r.start); // Monday maps to itself
    expect(boardRange("week", "2030-05-05", NY).start).toEqual(r.start); // Sunday belongs to the same week
  });

  it("a month is the calendar month", () => {
    const feb = boardRange("month", "2030-02-14", NY);
    expect(feb.ticks).toHaveLength(28);
    expect(localDate(feb.start, NY)).toBe("2030-02-01");
    expect(boardRange("month", "2032-02-14", NY).ticks).toHaveLength(29); // leap year
    expect(boardRange("month", "2030-12-31", NY).ticks).toHaveLength(31);
    expect(localDate(boardRange("month", "2030-12-31", NY).end, NY)).toBe("2031-01-01");
  });

  it("day lengths follow daylight saving, so the axis stays truthful", () => {
    const spring = boardRange("day", "2030-03-10", NY); // clocks jump forward: 23 hours
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23);
    expect(spring.ticks).toHaveLength(23); // the missing 2am tick is not drawn
    expect(spring.widthPx).toBe(23 * SCALE.day.pxPerHour);
    const fall = boardRange("day", "2030-11-03", NY); // clocks go back: 25 hours
    expect(fall.ticks).toHaveLength(25);
    expect(fall.ticks.filter((t) => t.label === "1a")).toHaveLength(2); // the repeated hour appears twice
    expect(new Set(fall.ticks.map((t) => t.at.getTime())).size).toBe(25); // no two ticks at the same instant
    expect(new Set(spring.ticks.map((t) => t.at.getTime())).size).toBe(23);
    expect(spring.ticks.map((t) => t.label)).not.toContain("2a"); // 2am does not exist that day
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25);
    const week = boardRange("week", "2030-03-10", NY);
    expect((week.end.getTime() - week.start.getTime()) / 3_600_000).toBe(
      7 * 24 - 1 + (week.start < spring.start ? 0 : 0),
    );
  });

  it("shifts by a view-unit", () => {
    expect(shiftDate("day", "2030-05-01", 1)).toBe("2030-05-02");
    expect(shiftDate("day", "2030-03-01", -1)).toBe("2030-02-28");
    expect(shiftDate("week", "2030-05-01", 1)).toBe("2030-05-08");
    expect(shiftDate("month", "2030-01-31", 1)).toBe("2030-02-01");
    expect(shiftDate("month", "2030-01-15", -1)).toBe("2029-12-01");
  });

  it("recognises real dates only", () => {
    expect(isDate("2030-05-01")).toBe(true);
    for (const bad of [
      "2030-02-30",
      "2030-13-01",
      "05/01/2030",
      "",
      null,
      undefined,
      20300501,
      "2030-5-1",
    ])
      expect(isDate(bad)).toBe(false);
  });
});

describe("pixels and time", () => {
  const r = boardRange("day", "2030-05-01", NY);

  it("converts instants to x and back, snapping to the grid", () => {
    expect(xFor(at("2030-05-01T09:00"), r)).toBe(9 * 64);
    expect(xFor(at("2030-05-01T09:30"), r)).toBe(9.5 * 64);
    expect(iso(timeAtX(9 * 64, r))).toBe(iso(at("2030-05-01T09:00")));
    expect(iso(timeAtX(9 * 64 + 5, r))).toBe(iso(at("2030-05-01T09:00"))); // 5px < half a 15-minute step (8px)
    expect(iso(timeAtX(9 * 64 + 9, r))).toBe(iso(at("2030-05-01T09:15")));
    expect(iso(timeAtX(0, r))).toBe(iso(r.start));
  });

  it("clips blocks to the visible range", () => {
    expect(blockFor(at("2030-05-01T09:00"), at("2030-05-01T11:00"), r)).toEqual({
      left: 9 * 64,
      width: 2 * 64,
    });
    expect(blockFor(at("2030-04-30T22:00"), at("2030-05-01T02:00"), r)).toEqual({
      left: 0,
      width: 2 * 64,
    }); // starts before
    expect(
      blockFor(at("2030-05-01T23:00"), at("2030-05-02T03:00"), r)!.left +
        blockFor(at("2030-05-01T23:00"), at("2030-05-02T03:00"), r)!.width,
    ).toBe(r.widthPx); // ends after
    expect(blockFor(at("2030-05-02T09:00"), at("2030-05-02T10:00"), r)).toBeNull();
    expect(blockFor(at("2030-04-30T09:00"), at("2030-05-01T00:00"), r)).toBeNull(); // ends exactly at the start
    expect(blockFor(at("2030-05-01T09:00"), at("2030-05-01T09:05"), r)!.width).toBeCloseTo(
      (5 / 60) * 64,
      6,
    ); // 5 minutes = 5.33 px
    expect(blockFor(at("2030-05-01T09:00"), at("2030-05-01T09:01"), r)!.width).toBe(4); // never thinner than a sliver you can grab
  });

  it("moves a booking by pixels, keeping its length and snapping", () => {
    const b = { start: at("2030-05-01T09:00"), end: at("2030-05-01T11:00") };
    const moved = moveByPixels(b, 64 * 2 + 3, r); // two hours and a bit
    expect(iso(moved.start)).toBe(iso(at("2030-05-01T11:00")));
    expect(iso(moved.end)).toBe(iso(at("2030-05-01T13:00")));
    const back = moveByPixels(b, -64 * 1.5, r);
    expect(iso(back.start)).toBe(iso(at("2030-05-01T07:30")));
    expect(moveByPixels(b, 0, r)).toEqual(b);
  });

  it("resizes from either edge, never below one step", () => {
    const b = { start: at("2030-05-01T09:00"), end: at("2030-05-01T11:00") };
    expect(iso(resizeEndByPixels(b, 64, r).end)).toBe(iso(at("2030-05-01T12:00")));
    expect(resizeEndByPixels(b, 64, r).start).toEqual(b.start);
    expect(iso(resizeEndByPixels(b, -64 * 10, r).end)).toBe(iso(at("2030-05-01T09:15"))); // clamped
    expect(iso(resizeStartByPixels(b, -64, r).start)).toBe(iso(at("2030-05-01T08:00")));
    expect(resizeStartByPixels(b, -64, r).end).toEqual(b.end);
    expect(iso(resizeStartByPixels(b, 64 * 10, r).start)).toBe(iso(at("2030-05-01T10:45"))); // clamped
  });

  it("uses each view's own grid", () => {
    const week = boardRange("week", "2030-05-01", NY);
    const b = { start: at("2030-05-01T09:00"), end: at("2030-05-01T10:00") };
    // 8 px/hour, 30-minute snap: 4px = half an hour.
    expect(iso(moveByPixels(b, 4, week).start)).toBe(iso(at("2030-05-01T09:30")));
    const month = boardRange("month", "2030-05-01", NY);
    expect(month.snapMinutes).toBe(60);
    expect(iso(moveByPixels(b, 2 * 48, month).start)).toBe(iso(at("2030-05-03T09:00"))); // a day is 48px at 2px/hour, so 96px = two days
  });
});

describe("lanes", () => {
  const item = (id: string, s: string, e: string) => ({
    id,
    start: at(`2030-05-01T${s}`),
    end: at(`2030-05-01T${e}`),
  });

  it("puts non-overlapping blocks in one lane", () => {
    const { lanes, count } = layoutLanes([
      item("a", "09:00", "10:00"),
      item("b", "10:00", "11:00"),
      item("c", "13:00", "14:00"),
    ]);
    expect(count).toBe(1);
    expect([...lanes.values()]).toEqual([0, 0, 0]);
  });

  it("stacks overlapping blocks and reuses a freed lane", () => {
    const { lanes, count } = layoutLanes([
      item("a", "09:00", "12:00"),
      item("b", "10:00", "11:00"),
      item("c", "10:30", "13:00"),
      item("d", "11:00", "12:00"),
    ]);
    expect(count).toBe(3);
    expect(lanes.get("a")).toBe(0);
    expect(lanes.get("b")).toBe(1);
    expect(lanes.get("c")).toBe(2);
    expect(lanes.get("d")).toBe(1); // b ended at 11:00, so its lane is free again
  });

  it("is stable for identical times and empty input", () => {
    const { lanes, count } = layoutLanes([
      item("x", "09:00", "10:00"),
      item("y", "09:00", "10:00"),
    ]);
    expect(count).toBe(2);
    expect(new Set(lanes.values()).size).toBe(2);
    expect(layoutLanes([]).count).toBe(1);
  });

  it("never gives two overlapping blocks the same lane (randomised)", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const items = Array.from({ length: 200 }, (_, i) => {
      const s = Math.floor(rnd() * 1000);
      return {
        id: `i${i}`,
        start: new Date(s * 60_000),
        end: new Date((s + 15 + Math.floor(rnd() * 240)) * 60_000),
      };
    });
    const { lanes } = layoutLanes(items);
    for (const a of items)
      for (const b of items) {
        if (a.id < b.id && a.start < b.end && b.start < a.end)
          expect(lanes.get(a.id), `${a.id} vs ${b.id}`).not.toBe(lanes.get(b.id));
      }
  });
});

describe("rows", () => {
  it("finds the row under a position, with varying heights", () => {
    const heights = [40, 80, 40];
    expect(rowAtY(0, heights)).toBe(0);
    expect(rowAtY(39, heights)).toBe(0);
    expect(rowAtY(40, heights)).toBe(1);
    expect(rowAtY(119, heights)).toBe(1);
    expect(rowAtY(120, heights)).toBe(2);
    expect(rowAtY(160, heights)).toBe(-1);
    expect(rowAtY(-1, heights)).toBe(-1);
  });
});

describe("performance", () => {
  it("lays out 25 resources x 1 week with 300 bookings well inside the time budget", () => {
    const r = boardRange("week", "2030-05-01", NY);
    const rows = Array.from({ length: 25 }, (_, i) => `r${i}`);
    const bookings = Array.from({ length: 300 }, (_, i) => {
      const start = new Date(r.start.getTime() + ((i * 37) % (7 * 24)) * 3_600_000);
      return {
        id: `b${i}`,
        row: rows[i % 25]!,
        start,
        end: new Date(start.getTime() + (1 + (i % 4)) * 3_600_000),
      };
    });
    const t0 = performance.now();
    for (let rep = 0; rep < 20; rep++) {
      for (const row of rows) {
        const mine = bookings.filter((b) => b.row === row);
        const { lanes } = layoutLanes(mine);
        for (const b of mine) {
          blockFor(b.start, b.end, r);
          void lanes.get(b.id);
        }
      }
    }
    const perPass = (performance.now() - t0) / 20;
    expect(perPass).toBeLessThan(50); // a full layout pass; the whole render budget is 1 s
  });
});
