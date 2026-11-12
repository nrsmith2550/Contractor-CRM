// Simple SLA: a case's due time is set from its priority when it is created (and re-derived from
// its creation time if the priority changes). Pure functions so the rules are easy to test.

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Hours allowed to resolve a case, by priority. */
export const SLA_HOURS: Record<Priority, number> = { urgent: 4, high: 8, normal: 24, low: 72 };

export const slaDueAt = (createdAt: Date, priority: Priority): Date =>
  new Date(createdAt.getTime() + SLA_HOURS[priority] * 3_600_000);

export type SlaState =
  | "none" // no SLA on this case
  | "on_track"
  | "due_soon" // less than a quarter of the allowed time left
  | "breached" // past due and still open
  | "met" // resolved on or before the due time
  | "missed" // resolved after the due time
  | "stopped"; // cancelled: no SLA to judge

export type SlaInfo = { state: SlaState; remainingMs: number | null };

/**
 * Where a case stands against its SLA right now. An open case counts down (negative once it is
 * past due); a resolved one is judged by when it was resolved, so the verdict never changes later.
 */
export function slaInfo(
  c: { status: string; createdAt: Date; slaDueAt: Date | null; resolvedAt: Date | null },
  now: Date = new Date(),
): SlaInfo {
  if (!c.slaDueAt) return { state: "none", remainingMs: null };
  const due = c.slaDueAt.getTime();
  if (c.status === "cancelled") return { state: "stopped", remainingMs: null };
  if (c.status === "resolved") {
    const at = (c.resolvedAt ?? now).getTime();
    return { state: at <= due ? "met" : "missed", remainingMs: null };
  }
  const remainingMs = due - now.getTime();
  if (remainingMs < 0) return { state: "breached", remainingMs };
  const allowed = due - c.createdAt.getTime();
  return { state: remainingMs < allowed / 4 ? "due_soon" : "on_track", remainingMs };
}

/** "3h 20m left", "45m left", "2h 5m overdue". */
export function formatRemaining(ms: number): string {
  const abs = Math.abs(ms);
  const mins = Math.floor(abs / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return ms < 0 ? `${text} overdue` : `${text} left`;
}
