import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUSES,
  canBookingTransition,
  nextBookingStatuses,
  occupiesTime,
  overlaps,
} from "@/server/domain/booking-status";
import {
  WEEKDAYS,
  defaultWorkHours,
  isWithinWorkHours,
  workHoursSchema,
  type WorkHours,
} from "@/server/domain/work-hours";
import { zonedToUtc } from "@/lib/tz";

const NY = "America/New_York";
const at = (local: string, tz = NY) => zonedToUtc(local, tz)!;

describe("booking status flow", () => {
  it("runs Scheduled -> Travelling -> In Progress -> Completed", () => {
    expect(canBookingTransition("scheduled", "travelling")).toBe(true);
    expect(canBookingTransition("travelling", "in_progress")).toBe(true);
    expect(canBookingTransition("in_progress", "completed")).toBe(true);
  });

  it("lets a technician already on site start directly, or turn around while travelling", () => {
    expect(canBookingTransition("scheduled", "in_progress")).toBe(true);
    expect(canBookingTransition("travelling", "scheduled")).toBe(true);
  });

  it("can't skip completion, move backwards from work, or leave a closed booking", () => {
    expect(canBookingTransition("scheduled", "completed")).toBe(false);
    expect(canBookingTransition("travelling", "completed")).toBe(false);
    expect(canBookingTransition("in_progress", "scheduled")).toBe(false);
    expect(canBookingTransition("in_progress", "cancelled")).toBe(false); // work started: finish it
    expect(nextBookingStatuses("completed")).toEqual([]);
    expect(nextBookingStatuses("cancelled")).toEqual([]);
    for (const s of BOOKING_STATUSES) expect(canBookingTransition(s, s)).toBe(false);
  });

  it("cancelled bookings don't occupy time", () => {
    expect(occupiesTime("cancelled")).toBe(false);
    for (const s of ["scheduled", "travelling", "in_progress", "completed"] as const)
      expect(occupiesTime(s)).toBe(true);
  });
});

describe("overlaps", () => {
  const r = (a: string, b: string) => ({ start: at(a), end: at(b) });
  it("detects overlap, and treats back-to-back bookings as fine", () => {
    expect(
      overlaps(
        r("2030-05-01T09:00", "2030-05-01T11:00"),
        r("2030-05-01T10:00", "2030-05-01T12:00"),
      ),
    ).toBe(true);
    expect(
      overlaps(
        r("2030-05-01T09:00", "2030-05-01T12:00"),
        r("2030-05-01T10:00", "2030-05-01T11:00"),
      ),
    ).toBe(true); // contained
    expect(
      overlaps(
        r("2030-05-01T09:00", "2030-05-01T10:00"),
        r("2030-05-01T10:00", "2030-05-01T11:00"),
      ),
    ).toBe(false); // touching
    expect(
      overlaps(
        r("2030-05-01T09:00", "2030-05-01T10:00"),
        r("2030-05-01T11:00", "2030-05-01T12:00"),
      ),
    ).toBe(false);
  });
});

describe("work hours", () => {
  const hours = defaultWorkHours();

  it("defaults to Monday to Friday 08:00-17:00", () => {
    expect(workHoursSchema.safeParse(hours).success).toBe(true);
    expect(hours.mon).toEqual([{ start: "08:00", end: "17:00" }]);
    expect(hours.sat).toEqual([]);
    expect(hours.sun).toEqual([]);
    expect(Object.keys(hours).sort()).toEqual([...WEEKDAYS].sort());
  });

  it("accepts a booking inside working hours, in the business's zone", () => {
    // 2030-05-01 is a Wednesday.
    expect(isWithinWorkHours(hours, at("2030-05-01T09:00"), at("2030-05-01T11:00"), NY)).toBe(true);
    expect(isWithinWorkHours(hours, at("2030-05-01T08:00"), at("2030-05-01T17:00"), NY)).toBe(true); // exactly the edges
    // Hours are read in the zone given: the same instants are 22:00-24:00 on a Wednesday evening in Tokyo.
    expect(isWithinWorkHours(hours, at("2030-05-01T09:00"), at("2030-05-01T11:00"), "UTC")).toBe(
      true,
    ); // 13:00-15:00 UTC
    expect(
      isWithinWorkHours(hours, at("2030-05-01T09:00"), at("2030-05-01T11:00"), "Asia/Tokyo"),
    ).toBe(false);
  });

  it("rejects bookings outside hours, on days off, across midnight or over a break", () => {
    expect(isWithinWorkHours(hours, at("2030-05-01T07:30"), at("2030-05-01T09:00"), NY)).toBe(
      false,
    ); // starts early
    expect(isWithinWorkHours(hours, at("2030-05-01T16:00"), at("2030-05-01T17:30"), NY)).toBe(
      false,
    ); // ends late
    expect(isWithinWorkHours(hours, at("2030-05-04T09:00"), at("2030-05-04T10:00"), NY)).toBe(
      false,
    ); // Saturday
    expect(isWithinWorkHours(hours, at("2030-05-01T16:00"), at("2030-05-02T09:00"), NY)).toBe(
      false,
    ); // overnight
    const split: WorkHours = {
      ...hours,
      wed: [
        { start: "08:00", end: "12:00" },
        { start: "13:00", end: "17:00" },
      ],
    };
    expect(isWithinWorkHours(split, at("2030-05-01T11:00"), at("2030-05-01T14:00"), NY)).toBe(
      false,
    ); // over the lunch break
    expect(isWithinWorkHours(split, at("2030-05-01T13:00"), at("2030-05-01T15:00"), NY)).toBe(true);
    expect(isWithinWorkHours(hours, at("2030-05-01T10:00"), at("2030-05-01T10:00"), NY)).toBe(
      false,
    ); // empty
    expect(isWithinWorkHours(hours, at("2030-05-01T11:00"), at("2030-05-01T10:00"), NY)).toBe(
      false,
    ); // backwards
  });

  it("a shift ending exactly at midnight stays within that day", () => {
    const night: WorkHours = { ...hours, wed: [{ start: "20:00", end: "23:59" }] };
    expect(isWithinWorkHours(night, at("2030-05-01T21:00"), at("2030-05-01T23:30"), NY)).toBe(true);
    const allDay: WorkHours = { ...hours, wed: [{ start: "00:00", end: "23:59" }] };
    expect(isWithinWorkHours(allDay, at("2030-05-01T22:00"), at("2030-05-02T00:00"), NY)).toBe(
      false,
    ); // 24:00 > 23:59
  });

  it("uses the zone's wall clock across daylight-saving changes", () => {
    // 2030-03-11 (Monday) after spring-forward: 09:00 local is 13:00 UTC; before it, 14:00 UTC.
    expect(isWithinWorkHours(hours, at("2030-03-11T09:00"), at("2030-03-11T10:00"), NY)).toBe(true);
    expect(isWithinWorkHours(hours, at("2030-03-08T09:00"), at("2030-03-08T10:00"), NY)).toBe(true); // Friday before
  });

  it("validates the schedule format", () => {
    const bad = (mut: (h: WorkHours) => void) => {
      const h = defaultWorkHours();
      mut(h);
      return workHoursSchema.safeParse(h).success;
    };
    expect(bad((h) => (h.mon = [{ start: "9:00", end: "17:00" }]))).toBe(false); // not HH:MM
    expect(bad((h) => (h.mon = [{ start: "17:00", end: "09:00" }]))).toBe(false); // ends before it starts
    expect(
      bad(
        (h) =>
          (h.mon = [
            { start: "08:00", end: "12:00" },
            { start: "11:00", end: "15:00" },
          ]),
      ),
    ).toBe(false); // overlap
    expect(
      bad(
        (h) =>
          (h.mon = [
            { start: "08:00", end: "09:00" },
            { start: "10:00", end: "11:00" },
            { start: "12:00", end: "13:00" },
            { start: "14:00", end: "15:00" },
          ]),
      ),
    ).toBe(false); // four
    expect(bad((h) => (h.mon = [{ start: "24:00", end: "25:00" }]))).toBe(false);
    expect(workHoursSchema.safeParse({ mon: [] }).success).toBe(false); // every weekday is required
    expect(bad((h) => (h.sun = [{ start: "10:00", end: "14:00" }]))).toBe(true);
  });
});
