import { describe, expect, it } from "vitest";
import { SLA_HOURS, formatRemaining, slaDueAt, slaInfo, type Priority } from "@/server/domain/sla";
import {
  WO_STATUSES,
  canTransition,
  isEditable,
  nextStatuses,
} from "@/server/domain/work-order-status";

const T0 = new Date("2026-03-02T09:00:00Z");
const H = 3_600_000;

describe("SLA due time", () => {
  it("is set from the priority", () => {
    expect(slaDueAt(T0, "urgent").getTime() - T0.getTime()).toBe(4 * H);
    expect(slaDueAt(T0, "high").getTime() - T0.getTime()).toBe(8 * H);
    expect(slaDueAt(T0, "normal").getTime() - T0.getTime()).toBe(24 * H);
    expect(slaDueAt(T0, "low").getTime() - T0.getTime()).toBe(72 * H);
  });

  it("a more urgent priority never has more time", () => {
    const order: Priority[] = ["urgent", "high", "normal", "low"];
    for (let i = 1; i < order.length; i++)
      expect(SLA_HOURS[order[i]!]).toBeGreaterThan(SLA_HOURS[order[i - 1]!]);
  });
});

describe("SLA state", () => {
  const open = (due: Date | null, over = {}) => ({
    status: "in_progress",
    createdAt: T0,
    slaDueAt: due,
    resolvedAt: null,
    ...over,
  });
  const due = slaDueAt(T0, "normal"); // T0 + 24h

  it("counts down while on track and turns due_soon in the last quarter", () => {
    expect(slaInfo(open(due), new Date(T0.getTime() + 1 * H))).toEqual({
      state: "on_track",
      remainingMs: 23 * H,
    });
    expect(slaInfo(open(due), new Date(T0.getTime() + 17 * H)).state).toBe("on_track"); // 7h left of 24h
    expect(slaInfo(open(due), new Date(T0.getTime() + 19 * H)).state).toBe("due_soon"); // 5h left < 6h
  });

  it("is breached once past due, with a negative remaining time", () => {
    expect(slaInfo(open(due), due)).toMatchObject({ state: "due_soon", remainingMs: 0 }); // exactly due is not yet breached
    expect(slaInfo(open(due), new Date(due.getTime() + 1))).toEqual({
      state: "breached",
      remainingMs: -1,
    });
    expect(slaInfo(open(due, { status: "on_hold" }), new Date(due.getTime() + 5 * H)).state).toBe(
      "breached",
    );
    expect(
      slaInfo(open(due, { status: "waiting_on_customer" }), new Date(due.getTime() + 5 * H)).state,
    ).toBe("breached");
  });

  it("a resolved case is judged by when it was resolved, forever", () => {
    const late = new Date(due.getTime() + 2 * H);
    expect(
      slaInfo(open(due, { status: "resolved", resolvedAt: new Date(T0.getTime() + 3 * H) }), late),
    ).toEqual({ state: "met", remainingMs: null });
    expect(slaInfo(open(due, { status: "resolved", resolvedAt: due }), late).state).toBe("met"); // on the dot counts
    expect(slaInfo(open(due, { status: "resolved", resolvedAt: late }), late).state).toBe("missed");
  });

  it("has no verdict for cancelled cases or cases without an SLA", () => {
    expect(slaInfo(open(due, { status: "cancelled" }), late()).state).toBe("stopped");
    expect(slaInfo(open(null), late()).state).toBe("none");
    function late() {
      return new Date(due.getTime() + 9 * H);
    }
  });

  it("formats the countdown", () => {
    expect(formatRemaining(3 * H + 20 * 60_000)).toBe("3h 20m left");
    expect(formatRemaining(45 * 60_000)).toBe("45m left");
    expect(formatRemaining(0)).toBe("0m left");
    expect(formatRemaining(-(2 * H + 5 * 60_000))).toBe("2h 5m overdue");
    expect(formatRemaining(26 * H)).toBe("1d 2h left");
  });
});

describe("work order status flow", () => {
  it("follows Unscheduled -> Scheduled -> In Progress -> Completed -> Posted", () => {
    expect(canTransition("unscheduled", "scheduled")).toBe(true);
    expect(canTransition("scheduled", "in_progress")).toBe(true);
    expect(canTransition("in_progress", "completed")).toBe(true);
    expect(canTransition("completed", "posted")).toBe(true);
  });

  it("can't skip steps or move out of Posted", () => {
    expect(canTransition("unscheduled", "in_progress")).toBe(false);
    expect(canTransition("unscheduled", "completed")).toBe(false);
    expect(canTransition("scheduled", "completed")).toBe(false);
    expect(canTransition("in_progress", "posted")).toBe(false);
    expect(nextStatuses("posted")).toEqual([]);
  });

  it("can be cancelled until the work is done, and a cancelled one reinstated", () => {
    for (const s of ["unscheduled", "scheduled", "in_progress"] as const)
      expect(canTransition(s, "cancelled")).toBe(true);
    expect(canTransition("completed", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "unscheduled")).toBe(true);
    expect(canTransition("cancelled", "scheduled")).toBe(false);
  });

  it("never transitions to itself and only completed/in-flight work reopens", () => {
    for (const s of WO_STATUSES) expect(canTransition(s, s)).toBe(false);
    expect(canTransition("completed", "in_progress")).toBe(true);
    expect(canTransition("scheduled", "unscheduled")).toBe(true);
  });

  it("is editable only before the work is done", () => {
    expect(isEditable("unscheduled")).toBe(true);
    expect(isEditable("scheduled")).toBe(true);
    expect(isEditable("in_progress")).toBe(true);
    for (const s of ["completed", "posted", "cancelled"] as const)
      expect(isEditable(s)).toBe(false);
  });
});
