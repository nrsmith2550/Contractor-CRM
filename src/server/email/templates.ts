import { TIERS, type Tier } from "@/lib/tiers";
import type { Email } from "./mailer";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The one and only time the full license key is delivered. */
export function licenseKeyEmail(args: {
  to: string;
  key: string;
  tier: Tier;
  appUrl: string;
}): Email {
  const t = TIERS[args.tier];
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
