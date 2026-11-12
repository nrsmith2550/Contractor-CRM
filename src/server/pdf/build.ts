import { eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { tenant } from "@/db/schema";
import { getAccount, getContact } from "@/server/domain/accounts";
import { fail, type Ctx, type Result } from "@/server/domain/context";
import { getQuote } from "@/server/domain/quotes";
import { renderQuotePdf } from "./quote-pdf";

/**
 * The PDF for a quote the user can read. Only quotes that have been activated can be rendered:
 * a draft is still being edited, so it would be a PDF of something not yet offered to the customer.
 */
export async function buildQuotePdf(
  ctx: Ctx,
  quoteId: string,
): Promise<Result<{ pdf: Buffer; filename: string }>> {
  const res = await getQuote(ctx, quoteId);
  if (!res.ok) return res;
  const { quote: q, lines } = res;
  if (q.status === "draft") {
    return fail("read_only", "Activate the quote before generating its PDF.");
  }

  const [t] = await withPlatform((tx) =>
    tx
      .select({
        name: tenant.name,
        logo: tenant.logoUrl,
        currency: tenant.currency,
        tz: tenant.timeZone,
      })
      .from(tenant)
      .where(eq(tenant.id, ctx.tenantId)),
  );

  // Customer details are best-effort: a user who can read the quote but not its account just
  // gets a PDF without the account's address.
  const account = q.customerAccountId ? await getAccount(ctx, q.customerAccountId) : null;
  const contact = q.customerContactId ? await getContact(ctx, q.customerContactId) : null;
  const a = account?.ok ? account.account : null;
  const c = contact?.ok ? contact.contact : null;
  const addressLines = a
    ? [
        a.addressStreet,
        [a.addressCity, a.addressRegion, a.addressPostalCode].filter(Boolean).join(", "),
        a.addressCountry,
      ].filter((l): l is string => Boolean(l))
    : [];

  const pdf = await renderQuotePdf({
    currency: t?.currency ?? "USD",
    timeZone: t?.tz ?? "UTC",
    company: { name: t?.name ?? "", logoDataUrl: t?.logo ?? null },
    quote: {
      number: q.quoteNumber,
      name: q.name,
      status: q.status,
      createdAt: q.createdAt,
      effectiveTo: q.effectiveTo,
      paymentTerms: q.paymentTerms,
      termsText: q.termsText,
      subtotalCents: q.subtotalCents,
      discountCents: q.discountCents,
      freightCents: q.freightCents,
      taxCents: q.taxCents,
      totalCents: q.totalCents,
    },
    customer: {
      name: a?.name ?? null,
      contact: c ? [c.firstName, c.lastName].filter(Boolean).join(" ") : null,
      addressLines,
    },
    lines: lines.map((l) => ({
      lineNumber: l.lineNumber,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      extendedCents: l.extendedCents,
    })),
  });
  return { ok: true, pdf, filename: `${q.quoteNumber}.pdf` };
}
