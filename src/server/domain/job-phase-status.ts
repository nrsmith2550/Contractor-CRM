// Phase status flow. A phase is a small job inside a main job, so it moves like one:
// Unscheduled -> Scheduled -> In Progress -> Completed, with Cancelled available until the work is
// done. (There is no "Posted" for a phase: only the main job is posted.) Pure, so it is easy to test.

export const PHASE_STATUSES = [
  "unscheduled",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

const NEXT: Record<PhaseStatus, PhaseStatus[]> = {
  unscheduled: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["unscheduled", "in_progress", "cancelled"],
  in_progress: ["scheduled", "completed", "cancelled"],
  completed: ["in_progress"], // reopen if the work wasn't actually finished
  cancelled: ["unscheduled"], // reinstated
};

export const isPhaseStatus = (v: unknown): v is PhaseStatus =>
  (PHASE_STATUSES as readonly unknown[]).includes(v);
export const canPhaseTransition = (from: PhaseStatus, to: PhaseStatus): boolean =>
  NEXT[from].includes(to);
export const nextPhaseStatuses = (from: PhaseStatus): readonly PhaseStatus[] => NEXT[from];

/** Open phases still have work to do; completed and cancelled ones do not. */
export const isOpenPhase = (s: string): boolean =>
  s === "unscheduled" || s === "scheduled" || s === "in_progress";

/** Details of a phase can be edited until it is completed or cancelled. */
export const isPhaseEditable = (s: PhaseStatus): boolean => s !== "completed" && s !== "cancelled";

/** A job can only take new phases, or have phases changed, while its own work is still open. */
export const jobAcceptsPhases = (jobStatus: string): boolean =>
  jobStatus === "unscheduled" || jobStatus === "scheduled" || jobStatus === "in_progress";

/** A main job is done only when no phase is still open. */
export const openPhaseCount = (statuses: readonly string[]): number =>
  statuses.filter(isOpenPhase).length;

/** The rolled-up picture shown on the job: "2 of 3 phases done". */
export function phaseProgress(statuses: readonly string[]): { done: number; total: number } {
  const counted = statuses.filter((s) => s !== "cancelled");
  return { done: counted.filter((s) => s === "completed").length, total: counted.length };
}
