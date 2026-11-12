// Booking status flow for a technician's visit: Scheduled -> Travelling -> In Progress ->
// Completed. A booking can be cancelled before work starts. Pure so the rules are easy to test.

export const BOOKING_STATUSES = [
  "scheduled",
  "travelling",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const NEXT: Record<BookingStatus, BookingStatus[]> = {
  scheduled: ["travelling", "in_progress", "cancelled"], // a technician already on site can start directly
  travelling: ["in_progress", "scheduled", "cancelled"], // back to scheduled if they turn around
  in_progress: ["completed"], // once work has started it ends in completion
  completed: [],
  cancelled: [],
};

export const isBookingStatus = (v: unknown): v is BookingStatus =>
  (BOOKING_STATUSES as readonly unknown[]).includes(v);
export const canBookingTransition = (from: BookingStatus, to: BookingStatus): boolean =>
  NEXT[from].includes(to);
export const nextBookingStatuses = (from: BookingStatus): readonly BookingStatus[] => NEXT[from];

/** Statuses in which a booking still occupies its resource's time (cancelled ones don't). */
export const occupiesTime = (s: BookingStatus): boolean => s !== "cancelled";

/** Two half-open time ranges overlap when each starts before the other ends. */
export const overlaps = (a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean =>
  a.start < b.end && b.start < a.end;
