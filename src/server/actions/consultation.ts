"use server";

import { bestTimeLabel, teamSizeLabel, timeZoneLabel, tradeLabel } from "@/lib/consultation";
import { LEGAL } from "@/lib/legal";
import { requestContext } from "@/server/auth/http";
import { submitConsultationRequest } from "@/server/domain/consultations";
import { sendEmail } from "@/server/email/mailer";
import { consultationConfirmEmail, consultationNotifyEmail } from "@/server/email/templates";

export type ConsultationResult =
  { ok: true } | { ok: false; message: string; errors?: Record<string, string> };

/** Public: no sign-in. Validates, stores, and emails the owner and the visitor (best effort). */
export async function requestConsultationAction(values: unknown): Promise<ConsultationResult> {
  const { ip } = await requestContext();
  const res = await submitConsultationRequest(values, { ip });
  if (!res.ok) return { ok: false, message: res.message, errors: res.errors };
  const r = res.request;
  if (!r) return { ok: true }; // a bot: look successful, do nothing

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const facts = {
    ...r,
    trade: tradeLabel(r.trade),
    teamSize: teamSizeLabel(r.teamSize),
    bestTime: bestTimeLabel(r.bestTime),
    timeZone: timeZoneLabel(r.timeZone),
  };
  for (const email of [
    consultationNotifyEmail({ to: LEGAL.email, appUrl, request: facts }),
    consultationConfirmEmail({
      to: r.email,
      name: r.name,
      phone: r.phone,
      bestTime: facts.bestTime,
      timeZone: facts.timeZone,
      supportEmail: LEGAL.email,
    }),
  ]) {
    try {
      await sendEmail(email);
    } catch (e) {
      // The request is saved and shows in the admin console; a mail failure must not lose it.
      console.error("consultation email failed:", e instanceof Error ? e.message : "unknown");
    }
  }
  return { ok: true };
}
