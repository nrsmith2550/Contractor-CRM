import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { activity, systemUser } from "@/db/schema";
import { hitRateLimit } from "@/server/auth/rate-limit";
import { sendEmail, type Email } from "@/server/email/mailer";
import { quoteEmail } from "@/server/email/templates";
import { formatMoney } from "@/lib/format";
import { can } from "@/server/security/roles";
import { buildQuotePdf } from "@/server/pdf/build";
import { getCompany } from "@/server/pdf/company";
import { recordAudit } from "./audit";
import { FORBIDDEN, fail, type Ctx, type Result } from "./context";
import { invalid } from "./leads";
import { getQuote } from "./quotes";

// Emailing a quote: the PDF goes out as an attachment, replies go to the sender, and an outgoing
// Email activity is logged on the quote. Nothing is logged if the send fails. A per-user limit
// keeps this from being used to send bulk mail to arbitrary addresses.

export const QUOTE_EMAIL_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;

const input = z.object({
  to: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  message: z.string().trim().max(2000).optional(),
});

export async function emailQuote(
  ctx: Ctx,
  quoteId: string,
  raw: unknown,
  deps: { send?: (e: Email) => Promise<void> } = {},
): Promise<Result<{ to: string; activityId: string }>> {
  if (!can(ctx.subject, "activity", "create")) return FORBIDDEN;
  const p = input.safeParse(raw);
  if (!p.success) return invalid(p);

  const q = await getQuote(ctx, quoteId);
  if (!q.ok) return q;
  if (q.quote.status === "revised") {
    return fail("read_only", "This quote has been revised. Send the latest revision instead.");
  }
  // Builds the PDF only for an activated quote, and refuses a draft.
  const doc = await buildQuotePdf(ctx, quoteId);
  if (!doc.ok) return doc;

  const limit = await hitRateLimit(`quoteemail:user:${ctx.userId}`, QUOTE_EMAIL_LIMIT);
  if (!limit.allowed) {
    return fail("rate_limited", "You've sent a lot of quotes in the last hour. Try again later.");
  }

  const [sender] = await withTenant(ctx.tenantId, (tx) =>
    tx
      .select({ name: systemUser.fullName, email: systemUser.email })
      .from(systemUser)
      .where(eq(systemUser.id, ctx.userId)),
  );
  const company = await getCompany(ctx.tenantId);

  const email: Email = {
    ...quoteEmail({
      to: p.data.to,
      company: company.name,
      quoteNumber: q.quote.quoteNumber,
      quoteName: q.quote.name,
      totalFormatted: formatMoney(q.quote.totalCents, company.currency),
      senderName: sender?.name ?? company.name,
      message: p.data.message,
      replyTo: sender?.email,
    }),
    attachments: [{ filename: doc.filename, content: doc.pdf, contentType: "application/pdf" }],
  };

  try {
    await (deps.send ?? sendEmail)(email);
  } catch {
    // The provider's message can include account details, so it isn't passed on or logged.
    return fail(
      "unavailable",
      "The email couldn't be sent. Check the email settings and try again.",
    );
  }

  return withTenant(ctx.tenantId, async (tx) => {
    const [row] = await tx
      .insert(activity)
      .values({
        tenantId: ctx.tenantId,
        ownerId: ctx.userId,
        createdBy: ctx.userId,
        modifiedBy: ctx.userId,
        activityType: "email",
        direction: "outgoing",
        status: "completed",
        subject: email.subject,
        description: [`To: ${p.data.to}`, `Attached: ${doc.filename}`, p.data.message]
          .filter(Boolean)
          .join("\n"),
        regardingType: "quote",
        regardingId: quoteId,
      })
      .returning({ id: activity.id });
    await recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "quote",
      recordId: quoteId,
      action: "email",
      changes: { to: p.data.to },
    });
    return { ok: true as const, to: p.data.to, activityId: row!.id };
  });
}
