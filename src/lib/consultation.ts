import { z } from "zod";

// A consultation request is an enquiry, not a booking: the visitor says who they are and when a
// call suits them, and the owner phones to agree the time. Pure data and validation only, so the
// form (in the browser) and the server check the very same rules.

export const TRADES = [
  ["hvac", "HVAC"],
  ["plumbing", "Plumbing"],
  ["roofing", "Roofing"],
  ["electrical", "Electrical"],
  ["landscaping", "Landscaping"],
  ["remodeling", "Remodeling"],
  ["painting", "Painting"],
  ["other", "Something else"],
] as const;

export const TEAM_SIZES = [
  ["solo", "Just me"],
  ["2-5", "2 to 5 people"],
  ["6-10", "6 to 10 people"],
  ["11-25", "11 to 25 people"],
  ["25+", "More than 25 people"],
] as const;

/** When the owner is free to phone. */
export const BEST_TIMES = [
  ["weekday_evenings", "Weekday evenings"],
  ["saturdays", "Saturdays"],
  ["either", "Either works"],
] as const;

export const TIME_ZONES = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
] as const;

export const REQUEST_STATUSES = ["new", "contacted", "scheduled", "done", "spam"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

const values = <T extends readonly (readonly [string, string])[]>(list: T) =>
  list.map(([v]) => v) as unknown as [T[number][0], ...T[number][0][]];

/** What a person typed into the phone box, reduced to its digits (a leading + is kept out). */
export const phoneDigits = (raw: string): string => raw.replace(/\D/g, "");

export const consultationSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(254),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((p) => {
      const d = phoneDigits(p);
      return d.length >= 10 && d.length <= 15;
    }, "Enter a phone number we can call, with the area code"),
  business: z.string().trim().min(2, "Enter your business name").max(120),
  trade: z.enum(values(TRADES), { message: "Choose your trade" }),
  teamSize: z.enum(values(TEAM_SIZES), { message: "Choose your team size" }),
  bestTime: z.enum(values(BEST_TIMES), { message: "Choose when to call" }),
  timeZone: z.enum(values(TIME_ZONES), { message: "Choose your time zone" }),
  message: z.string().trim().max(1000, "Keep it under 1,000 characters").optional(),
  /** A trap for bots: a real person never sees this box, so it must stay empty. */
  website: z.string().max(200).optional(),
});

export type ConsultationInput = z.infer<typeof consultationSchema>;

const labelIn = (list: readonly (readonly [string, string])[], v: string) =>
  list.find(([k]) => k === v)?.[1] ?? v;
export const tradeLabel = (v: string) => labelIn(TRADES, v);
export const teamSizeLabel = (v: string) => labelIn(TEAM_SIZES, v);
export const bestTimeLabel = (v: string) => labelIn(BEST_TIMES, v);
export const timeZoneLabel = (v: string) => labelIn(TIME_ZONES, v);
