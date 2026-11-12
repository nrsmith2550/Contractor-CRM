// Work order status flow: Unscheduled -> Scheduled -> In Progress -> Completed -> Posted,
// with Cancelled available until the work is done. Pure so the rules are easy to test; the
// domain layer (and, later, bookings) call canTransition before changing a status.

export const WO_STATUSES = [
  "unscheduled",
  "scheduled",
  "in_progress",
  "completed",
  "posted",
  "cancelled",
] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

const NEXT: Record<WoStatus, WoStatus[]> = {
  unscheduled: ["scheduled", "cancelled"],
  scheduled: ["unscheduled", "in_progress", "cancelled"], // unscheduled again if its booking is cancelled
  in_progress: ["scheduled", "completed", "cancelled"], // back to scheduled if the visit is rebooked
  completed: ["posted", "in_progress"], // reopen if the work wasn't actually finished
  posted: [], // posted work feeds an invoice and is final
  cancelled: ["unscheduled"], // reinstated
};

export const isWoStatus = (v: unknown): v is WoStatus =>
  (WO_STATUSES as readonly unknown[]).includes(v);
export const canTransition = (from: WoStatus, to: WoStatus): boolean => NEXT[from].includes(to);
export const nextStatuses = (from: WoStatus): readonly WoStatus[] => NEXT[from];

/** Fields of a work order that can still be edited in this status. */
export const isEditable = (s: WoStatus): boolean =>
  s !== "completed" && s !== "posted" && s !== "cancelled";
