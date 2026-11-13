import { describe, expect, it } from "vitest";
import { dayRange, quarterRange } from "@/lib/dashboard";

describe("quarterRange", () => {
  it("finds the quarter in the business's zone", () => {
    const q = quarterRange(new Date("2030-05-15T12:00:00Z"), "UTC");
    expect(q).toMatchObject({ label: "Q2 2030", startDate: "2030-04-01", endDate: "2030-07-01" });
    expect(q.start.toISOString()).toBe("2030-04-01T00:00:00.000Z");
    expect(q.end.toISOString()).toBe("2030-07-01T00:00:00.000Z");
  });
  it("rolls the year over for the last quarter", () => {
    expect(quarterRange(new Date("2030-12-31T12:00:00Z"), "UTC")).toMatchObject({
      label: "Q4 2030",
      startDate: "2030-10-01",
      endDate: "2031-01-01",
    });
  });
  it("uses local time at a boundary", () => {
    // 02:00 UTC on 1 July is still 30 June in New York: that is Q2 there and Q3 in UTC.
    const at = new Date("2030-07-01T02:00:00Z");
    expect(quarterRange(at, "America/New_York").label).toBe("Q2 2030");
    expect(quarterRange(at, "UTC").label).toBe("Q3 2030");
    expect(quarterRange(at, "America/New_York").start.toISOString()).toBe(
      "2030-04-01T04:00:00.000Z",
    );
  });
});

describe("dayRange", () => {
  it("spans the local day", () => {
    const d = dayRange(new Date("2030-05-02T03:00:00Z"), "America/New_York"); // still 1 May there
    expect(d.date).toBe("2030-05-01");
    expect(d.start.toISOString()).toBe("2030-05-01T04:00:00.000Z");
    expect(d.end.toISOString()).toBe("2030-05-02T04:00:00.000Z");
  });
  it("is 23 hours long when the clocks go forward", () => {
    const d = dayRange(new Date("2030-03-10T15:00:00Z"), "America/New_York");
    expect((d.end.getTime() - d.start.getTime()) / 3_600_000).toBe(23);
  });
  it("is 25 hours long when the clocks go back", () => {
    const d = dayRange(new Date("2030-11-03T15:00:00Z"), "America/New_York");
    expect((d.end.getTime() - d.start.getTime()) / 3_600_000).toBe(25);
  });
});
