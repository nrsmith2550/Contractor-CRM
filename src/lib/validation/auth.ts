import { z } from "zod";

// Pure schemas shared by the browser (React Hook Form resolver) and the server actions, so a
// form and its endpoint can never disagree. No server-only imports here.

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Offered in the activation form; the server accepts any ISO-4217-shaped code. */
export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "MXN"] as const;

export const emailField = z.string().trim().toLowerCase().email("Enter a valid email").max(254);

export const activateFields = z.object({
  licenseKey: z.string().trim().min(1, "Enter your license key").max(100),
  companyName: z.string().trim().min(1, "Enter your company name").max(120),
  ownerName: z.string().trim().min(1, "Enter your full name").max(120),
  ownerEmail: emailField,
  password: z.string().max(256),
  confirmPassword: z.string().max(256),
  timeZone: z.string().refine(isTimeZone, "Choose a time zone"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code"),
});

type WithConfirm = { confirmPassword: string };
export const passwordsMatch = (v: WithConfirm & { password: string }) =>
  v.password === v.confirmPassword;

export const activateFormSchema = activateFields.refine(passwordsMatch, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
export type ActivateFormValues = z.input<typeof activateFormSchema>;

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Enter your password").max(256),
});
export type LoginValues = z.input<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(256),
    password: z.string().max(256),
    confirmPassword: z.string().max(256),
  })
  .refine(passwordsMatch, { message: "Passwords do not match", path: ["confirmPassword"] });
export type ChangePasswordValues = z.input<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;

// The reset / invitation token comes from the link, not from the form.
export const resetPasswordSchema = z
  .object({ password: z.string().max(256), confirmPassword: z.string().max(256) })
  .refine(passwordsMatch, { message: "Passwords do not match", path: ["confirmPassword"] });
export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;

export const acceptInviteSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your full name").max(120),
    password: z.string().max(256),
    confirmPassword: z.string().max(256),
  })
  .refine(passwordsMatch, { message: "Passwords do not match", path: ["confirmPassword"] });
export type AcceptInviteValues = z.input<typeof acceptInviteSchema>;

export const inviteUserSchema = z.object({
  email: emailField,
  roleId: z.string().uuid("Choose a role"),
});
export type InviteUserValues = z.input<typeof inviteUserSchema>;
