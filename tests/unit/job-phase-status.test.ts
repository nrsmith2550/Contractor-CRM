import { describe, expect, it } from "vitest";
import {
  PHASE_STATUSES,
  canPhaseTransition,
  isOpenPhase,
  isPhaseEditable,
  jobAcceptsPhases,
  nextPhaseStatuses,
  openPhaseCount,
  phaseProgress,
} from "@/server/domain/job-phase-status";

describe("phase status flow", () => {
  it("moves like a small job: unscheduled, scheduled, in progress, completed", () => {
    expect(canPhaseTransition("unscheduled", "scheduled")).toBe(true);
    expect(canPhaseTransition("scheduled", "in_progress")).toBe(true);
    expect(canPhaseTransition("in_progress", "completed")).toBe(true);
  });

  it("cannot skip straight to completed, and has no posted state", () => {
    expect(canPhaseTransition("unscheduled", "completed")).toBe(false);
    expect(canPhaseTransition("scheduled", "completed")).toBe(false);
    expect(PHASE_STATUSES).not.toContain("posted");
  });

  it("can be cancelled until done, reinstated, and reopened if not really finished", () => {
    for (const s of ["unscheduled", "scheduled", "in_progress"] as const)
      expect(canPhaseTransition(s, "cancelled")).toBe(true);
    expect(canPhaseTransition("completed", "cancelled")).toBe(false);
    expect(canPhaseTransition("cancelled", "unscheduled")).toBe(true);
    expect(nextPhaseStatuses("completed")).toEqual(["in_progress"]);
  });

  it("only open phases hold up the main job", () => {
    expect(["unscheduled", "scheduled", "in_progress"].every(isOpenPhase)).toBe(true);
    expect(isOpenPhase("completed")).toBe(false);
    expect(isOpenPhase("cancelled")).toBe(false);
    expect(openPhaseCount(["completed", "cancelled", "scheduled", "in_progress"])).toBe(2);
  });

  it("locks details once a phase is finished or cancelled", () => {
    expect(isPhaseEditable("in_progress")).toBe(true);
    expect(isPhaseEditable("completed")).toBe(false);
    expect(isPhaseEditable("cancelled")).toBe(false);
  });

  it("takes phases only while the main job's work is open", () => {
    for (const s of ["unscheduled", "scheduled", "in_progress"])
      expect(jobAcceptsPhases(s)).toBe(true);
    for (const s of ["completed", "posted", "cancelled"]) expect(jobAcceptsPhases(s)).toBe(false);
  });

  it("counts progress without the cancelled phases", () => {
    expect(phaseProgress(["completed", "completed", "scheduled", "cancelled"])).toEqual({
      done: 2,
      total: 3,
    });
    expect(phaseProgress([])).toEqual({ done: 0, total: 0 });
  });
});
