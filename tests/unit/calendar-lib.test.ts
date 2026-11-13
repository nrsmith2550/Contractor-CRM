import { describe, expect, it } from "vitest";
import { fromWallClock, rangeFromCalendar, recordHref, wallClock } from "@/lib/calendar";

const NY = "America/New_York";
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("wall clock", () => {
  it("writes an instant as the zone's wall-clock time", () => {
    expect(wallClock(new Date("2030-07-15T13:00:00Z"), NY)).toBe("2030-07-15T09:00:00");
    expect(wallClock(new Date("2030-01-15T14:30:00Z"), NY)).toBe("2030-01-15T09:30:00");
    expect(wallClock(new Date("2030-01-15T14:30:00Z"), "UTC")).toBe("2030-01-15T14:30:00");
    expect(wallClock(new Date("2030-07-14T23:00:00Z"), "Australia/Sydney")).toBe(
      "2030-07-15T09:00:00",
    );
  });

  it("reads calendar text back to the real instant, ignoring seconds and a trailing Z", () => {
    expect(iso(fromWallClock("2030-07-15T09:00", NY))).toBe("2030-07-15T13:00:00.000Z");
    expect(iso(fromWallClock("2030-07-15T09:00:00", NY))).toBe("2030-07-15T13:00:00.000Z");
    expect(iso(fromWallClock("2030-07-15T09:00:00Z", NY))).toBe("2030-07-15T13:00:00.000Z"); // UTC mode: Z means "unshifted"
    expect(iso(fromWallClock("2030-07-15T09:00:00+00:00", NY))).toBe("2030-07-15T13:00:00.000Z");
    expect(iso(fromWallClock("2030-07-15", NY))).toBe("2030-07-15T04:00:00.000Z"); // date only: midnight
  });

  it("round-trips across a year in several zones", () => {
    for (const tz of [NY, "Europe/London", "Asia/Kolkata", "Australia/Sydney", "UTC"]) {
      for (let day = 0; day < 365; day += 11) {
        const at = new Date(Date.UTC(2030, 0, 1 + day, 10, 15));
        expect(iso(fromWallClock(wallClock(at, tz), tz)), `${tz} ${day}`).toBe(iso(at));
      }
    }
  });

  it("rejects text that isn't a date", () => {
    for (const bad of [
      "",
      "garbage",
      "05/01/2030",
      null,
      undefined,
      42,
      "2030-13-01T09:00",
      "2030-02-31T09:00",
    ]) {
      expect(fromWallClock(bad, NY), String(bad)).toBeNull();
    }
  });
});

describe("visible range", () => {
  it("converts a month view's range", () => {
    const r = rangeFromCalendar("2030-04-28T00:00:00Z", "2030-06-09T00:00:00Z", NY)!;
    expect(iso(r.from)).toBe("2030-04-28T04:00:00.000Z");
    expect(iso(r.to)).toBe("2030-06-09T04:00:00.000Z");
  });

  it("refuses an empty, backwards, unparseable or absurdly long range", () => {
    expect(rangeFromCalendar("2030-05-01", "2030-05-01", NY)).toBeNull();
    expect(rangeFromCalendar("2030-05-02", "2030-05-01", NY)).toBeNull();
    expect(rangeFromCalendar("x", "2030-05-01", NY)).toBeNull();
    expect(rangeFromCalendar("2030-05-01", undefined, NY)).toBeNull();
    expect(rangeFromCalendar("2000-01-01", "2030-01-01", NY)).toBeNull();
    expect(rangeFromCalendar("2030-05-01", "2030-06-30", NY)).not.toBeNull();
  });
});

describe("record links", () => {
  it("links the records that have pages", () => {
    expect(recordHref("lead", "abc")).toBe("/app/prospects/abc");
    expect(recordHref("opportunity", "x")).toBe("/app/deals/x");
    expect(recordHref("work_order", "w")).toBe("/app/jobs/w");
    expect(recordHref("case", "c")).toBe("/app/support-requests/c");
    expect(recordHref("quote", "q")).toBe("/app/quotes/q");
  });
  it("returns null for the rest", () => {
    expect(recordHref("note", "x")).toBeNull();
    expect(recordHref(null, "x")).toBeNull();
    expect(recordHref("lead", null)).toBeNull();
    expect(recordHref("../../etc", "x")).toBeNull();
  });
});
