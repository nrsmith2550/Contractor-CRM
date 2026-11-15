// The facts the Terms and Privacy Policy quote, kept in one place so the two pages and the
// checkout agree with each other. Change a value here and every page follows.

export const LEGAL = {
  /** Who sells Gantry CRM. */
  seller: "Nathan Smith, doing business as Gantry CRM",
  place: "Pittsburgh, Pennsylvania, USA",
  /** Where the courts are and whose law applies. */
  law: "Pennsylvania",
  county: "Allegheny County, Pennsylvania",
  /** Days after the first purchase in which everything is refunded on request. */
  refundDays: 14,
  /** Days of notice before a price or a term changes. */
  noticeDays: 30,
  /** Days to delete a business's data after it asks. */
  deleteDays: 30,
  /** Where people write. */
  email: process.env.SUPPORT_EMAIL ?? "support@gantrycrm.com",
  updated: "November 15, 2026",
} as const;

/** The companies that handle data for Gantry, and what each does. Named in the Privacy Policy. */
export const PROVIDERS = [
  ["Stripe", "takes card payments and keeps the card details"],
  ["Vercel", "hosts the website and the app"],
  ["Neon", "stores the database"],
  ["Resend", "sends the emails the app sends (licence keys, invitations, password resets, quotes)"],
  ["ImprovMX", "forwards email sent to our support address"],
] as const;
