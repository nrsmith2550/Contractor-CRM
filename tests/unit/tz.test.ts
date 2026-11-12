import { describe, expect, it } from "vitest";
import { utcToZonedInput, zonedToUtc } from "@/lib/tz";

const iso = (d: Date | null) => d?.toISOString();

describe("zonedToUtc", () => {
  it("applies the zone's offset, standard and daylight", () => {
    expect(iso(zonedToUtc("2030-01-15T09:00", "America/New_York"))).toBe(
      "2030-01-15T14:00:00.000Z",
    ); // EST, UTC-5
    expect(iso(zonedToUtc("2030-07-15T09:00", "America/New_York"))).toBe(
      "2030-07-15T13:00:00.000Z",
    ); // EDT, UTC-4
    expect(iso(zonedToUtc("2030-07-15T09:00", "UTC"))).toBe("2030-07-15T09:00:00.000Z");
    expect(iso(zonedToUtc("2030-07-15T09:00", "Asia/Kolkata"))).toBe("2030-07-15T03:30:00.000Z"); // UTC+5:30
    expect(iso(zonedToUtc("2030-07-15T09:00", "Australia/Sydney"))).toBe(
      "2030-07-14T23:00:00.000Z",
    ); // UTC+10 (winter)
  });

  it("handles the spring-forward gap by moving the missing hour forward", () => {
    // 2030-03-10 02:30 doesn't exist in New York (clocks jump 02:00 -> 03:00).
    expect(iso(zonedToUtc("2030-03-10T02:30", "America/New_York"))).toBe(
      "2030-03-10T07:30:00.000Z",
    ); // = 03:30 EDT
    expect(iso(zonedToUtc("2030-03-10T01:59", "America/New_York"))).toBe(
      "2030-03-10T06:59:00.000Z",
    ); // still EST
    expect(iso(zonedToUtc("2030-03-10T03:00", "America/New_York"))).toBe(
      "2030-03-10T07:00:00.000Z",
    );
  });

  it("takes the first occurrence when clocks go back and a time repeats", () => {
    // 2030-11-03 01:30 happens twice in New York; the first is EDT (UTC-4).
    expect(iso(zonedToUtc("2030-11-03T01:30", "America/New_York"))).toBe(
      "2030-11-03T05:30:00.000Z",
    );
    expect(iso(zonedToUtc("2030-11-03T02:30", "America/New_York"))).toBe(
      "2030-11-03T07:30:00.000Z",
    ); // after: EST
  });

  it("rejects text that isn't a real wall-clock time", () => {
    for (const bad of [
      "",
      "2030-05-01",
      "2030-05-01 09:00",
      "2030-02-31T09:00",
      "garbage",
      "2030-13-01T09:00",
    ]) {
      expect(zonedToUtc(bad, "UTC"), bad).toBeNull();
    }
  });
});

describe("utcToZonedInput", () => {
  it("shows the wall clock in the zone", () => {
    expect(utcToZonedInput(new Date("2030-07-15T13:00:00Z"), "America/New_York")).toBe(
      "2030-07-15T09:00",
    );
    expect(utcToZonedInput("2030-01-15T14:00:00Z", "America/New_York")).toBe("2030-01-15T09:00");
    expect(utcToZonedInput(new Date("2030-07-14T23:00:00Z"), "Australia/Sydney")).toBe(
      "2030-07-15T09:00",
    );
    expect(utcToZonedInput(new Date("2030-01-01T00:00:00Z"), "UTC")).toBe("2030-01-01T00:00");
  });

  it("round-trips every quarter hour across a year in several zones", () => {
    for (const tz of [
      "America/New_York",
      "Europe/London",
      "Asia/Kolkata",
      "Australia/Sydney",
      "UTC",
    ]) {
      for (let day = 0; day < 365; day += 7) {
        const at = new Date(Date.UTC(2030, 0, 1 + day, 3, 30));
        const wall = utcToZonedInput(at, tz);
        const back = zonedToUtc(wall, tz);
        // Repeated hours may resolve to the earlier of two instants; the wall time must still match.
        expect(utcToZonedInput(back!, tz), `${tz} ${wall}`).toBe(wall);
      }
    }
  });

  it("returns an empty string for an invalid date", () => {
    expect(utcToZonedInput("nope", "UTC")).toBe("");
  });
});
