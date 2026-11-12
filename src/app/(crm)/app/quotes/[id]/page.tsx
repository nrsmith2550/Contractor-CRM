import { notFound } from "next/navigation";
import { QuoteBuilder } from "@/components/form/QuoteBuilder";
import { requireUser } from "@/server/auth/http";
import { listProducts } from "@/server/domain/catalog";
import { buildCtx } from "@/server/domain/context";
import { getContact } from "@/server/domain/accounts";
import { timeline } from "@/server/domain/activities";
import { getQuote } from "@/server/domain/quotes";
import { formatDateTime } from "@/lib/format";
import { tenantTimeZone } from "@/server/entities/tenant";
import { formatMoney } from "@/lib/format";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const res = await getQuote(ctx, id);
  if (!res.ok) notFound();
  const products = await listProducts(ctx, { limit: 200 });
  const q = res.quote;
  const contact = q.customerContactId ? await getContact(ctx, q.customerContactId) : null;
  const tl = await timeline(ctx, "quote", id);
  const tz = await tenantTimeZone(user.tenantId);
  const emails = tl.ok
    ? tl.items.flatMap((i) =>
        i.kind === "activity" && i.activity.activityType === "email" ? [i] : [],
      )
    : [];
  return (
    <>
      <h1>{q.name}</h1>
      <p>
        Quote {q.quoteNumber} · {formatMoney(q.totalCents)}
      </p>
      <QuoteBuilder
        quote={{
          id: q.id,
          quoteNumber: q.quoteNumber,
          name: q.name,
          status: q.status,
          opportunityId: q.opportunityId,
          paymentTerms: q.paymentTerms ?? "",
          termsText: q.termsText ?? "",
          freightCents: q.freightCents,
          discountPercentBp: q.discountPercentBp,
          discountAmountCents: q.discountAmountCents,
          subtotalCents: q.subtotalCents,
          discountCents: q.discountCents,
          taxCents: q.taxCents,
          totalCents: q.totalCents,
        }}
        lines={res.lines.map((l) => ({
          id: l.id,
          lineNumber: l.lineNumber,
          description: l.description,
          quantityMilli: l.quantityMilli,
          unitPriceCents: l.unitPriceCents,
          discountCents: l.discountCents,
          taxRateBp: l.taxRateBp,
          extendedCents: l.extendedCents,
        }))}
        defaultTo={contact?.ok ? (contact.contact.email ?? "") : ""}
        products={
          products.ok ? products.rows.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` })) : []
        }
      />
      {emails.length > 0 && (
        <>
          <h2>Emails sent</h2>
          <ul aria-label="Emails sent">
            {emails.map((e) => (
              <li key={e.activity.id}>
                <strong>{e.activity.subject}</strong> · {formatDateTime(e.at, tz)}
                <div style={{ whiteSpace: "pre-wrap" }}>{e.activity.description}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
