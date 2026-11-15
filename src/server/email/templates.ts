import { PLANS, seatsFor, type Edition } from "@/lib/plans";
import type { Email } from "./mailer";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The one and only time the full license key is delivered. */
export function licenseKeyEmail(args: {
  to: string;
  key: string;
  edition: Edition;
  extraUsers: number;
  appUrl: string;
}): Email {
  const t = { label: PLANS[args.edition].name, seatLimit: seatsFor(args.extraUsers) };
  const url = `${args.appUrl.replace(/\/$/, "")}/activate`;
  const text = [
    `Thank you for your purchase. Here is your ${t.label} license key (up to ${t.seatLimit} users):`,
    "",
    args.key,
    "",
    `Activate it once at ${url} — you'll create your business and your owner sign-in there.`,
    "",
    "Keep this email: for security we only store a fingerprint of the key, so we can't show it again.",
  ].join("\n");
  const html = `<p>Thank you for your purchase. Here is your <strong>${esc(t.label)}</strong> license key (up to ${t.seatLimit} users):</p>
<p style="font-family:monospace;font-size:18px;letter-spacing:1px">${esc(args.key)}</p>
<p>Activate it once at <a href="${esc(url)}">${esc(url)}</a> — you'll create your business and your owner sign-in there.</p>
<p>Keep this email: for security we only store a fingerprint of the key, so we can't show it again.</p>`;
  return { to: args.to, subject: `Your ${t.label} license key`, text, html };
}

const link = (appUrl: string, path: string, token: string) =>
  `${appUrl.replace(/\/$/, "")}${path}?token=${encodeURIComponent(token)}`;

/** Single-use link, valid for 30 minutes. The token itself is never stored, only its hash. */
export function passwordResetEmail(args: { to: string; token: string; appUrl: string }): Email {
  const url = link(args.appUrl, "/reset-password", args.token);
  const text = [
    "We received a request to reset your password.",
    "",
    `Choose a new password here (the link works once and expires in 30 minutes): ${url}`,
    "",
    "If you didn't ask for this, you can ignore this email — your password hasn't changed.",
  ].join("\n");
  const html = `<p>We received a request to reset your password.</p>
<p><a href="${esc(url)}">Choose a new password</a> — the link works once and expires in 30 minutes.</p>
<p>If you didn't ask for this, you can ignore this email — your password hasn't changed.</p>`;
  return { to: args.to, subject: "Reset your password", text, html };
}

export function invitationEmail(args: {
  to: string;
  token: string;
  appUrl: string;
  companyName: string;
  inviterName: string;
}): Email {
  const url = link(args.appUrl, "/accept-invite", args.token);
  const text = [
    `${args.inviterName} invited you to join ${args.companyName}.`,
    "",
    `Set your password and get started (the link expires in 7 days): ${url}`,
  ].join("\n");
  const html = `<p>${esc(args.inviterName)} invited you to join <strong>${esc(args.companyName)}</strong>.</p>
<p><a href="${esc(url)}">Set your password and get started</a> — the link expires in 7 days.</p>`;
  return { to: args.to, subject: `You're invited to ${args.companyName}`, text, html };
}

/** A quote sent to a customer, with the PDF attached by the caller. */
export function quoteEmail(args: {
  to: string;
  company: string;
  quoteNumber: string;
  quoteName: string;
  totalFormatted: string;
  senderName: string;
  message?: string | null;
  replyTo?: string;
}): Email {
  const note = args.message?.trim();
  const text = [
    `Hello,`,
    "",
    ...(note ? [note, ""] : []),
    `Please find attached quote ${args.quoteNumber} (${args.quoteName}) from ${args.company}, for a total of ${args.totalFormatted}.`,
    "",
    `Reply to this email if you have any questions.`,
    "",
    `${args.senderName}`,
    args.company,
  ].join("\n");
  const html = `<p>Hello,</p>
${note ? `<p style="white-space:pre-wrap">${esc(note)}</p>` : ""}
<p>Please find attached quote <strong>${esc(args.quoteNumber)}</strong> (${esc(args.quoteName)}) from ${esc(args.company)}, for a total of <strong>${esc(args.totalFormatted)}</strong>.</p>
<p>Reply to this email if you have any questions.</p>
<p>${esc(args.senderName)}<br>${esc(args.company)}</p>`;
  return {
    to: args.to,
    subject: `Quote ${args.quoteNumber} from ${args.company}`,
    text,
    html,
    replyTo: args.replyTo,
  };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

type ConsultationFacts = {
  name: string;
  email: string;
  phone: string;
  business: string;
  trade: string;
  teamSize: string;
  bestTime: string;
  timeZone: string;
  message?: string | null;
};

/** To the owner: a new consultation request. Replies go straight to the visitor. */
export function consultationNotifyEmail(args: {
  to: string;
  appUrl: string;
  request: ConsultationFacts;
}): Email {
  const r = args.request;
  const url = `${args.appUrl.replace(/\/$/, "")}/admin/consultations`;
  const rows: [string, string][] = [
    ["Name", r.name],
    ["Business", r.business],
    ["Trade", r.trade],
    ["Team size", r.teamSize],
    ["Phone", r.phone],
    ["Email", r.email],
    ["Best time to call", `${r.bestTime} (${r.timeZone})`],
  ];
  const text = [
    "New consultation request:",
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(r.message ? ["", "Message:", r.message] : []),
    "",
    `Review and track it: ${url}`,
  ].join("\n");
  const html = `<p>New consultation request:</p>
<table>${rows.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${esc(v)}</td></tr>`).join("")}</table>
${r.message ? `<p><strong>Message</strong><br>${esc(r.message).replace(/\n/g, "<br>")}</p>` : ""}
<p><a href="${esc(url)}">Review and track it</a></p>`;
  return {
    to: args.to,
    subject: `Consultation request: ${oneLine(r.name)} (${oneLine(r.business)})`,
    text,
    html,
    replyTo: r.email,
  };
}

/** To the visitor: proof their request arrived, and what happens next. */
export function consultationConfirmEmail(args: {
  to: string;
  name: string;
  phone: string;
  bestTime: string;
  timeZone: string;
  supportEmail: string;
}): Email {
  const when = `${args.bestTime.toLowerCase()} (${args.timeZone})`;
  const text = [
    `Hi ${oneLine(args.name)},`,
    "",
    "Thanks for asking about Gantry CRM. We got your request.",
    `We will call you on ${args.phone}, ${when}, usually within two business days, to talk it through and agree a time for a 30-minute consultation.`,
    "",
    `Need to change something? Just reply to this email or write to ${args.supportEmail}.`,
  ].join("\n");
  const html = `<p>Hi ${esc(args.name)},</p>
<p>Thanks for asking about Gantry CRM. We got your request.</p>
<p>We will call you on <strong>${esc(args.phone)}</strong>, ${esc(when)}, usually within two business days, to talk it through and agree a time for a 30-minute consultation.</p>
<p>Need to change something? Just reply to this email or write to <a href="mailto:${esc(args.supportEmail)}">${esc(args.supportEmail)}</a>.</p>`;
  return { to: args.to, subject: "We got your consultation request", text, html, replyTo: args.supportEmail };
}
