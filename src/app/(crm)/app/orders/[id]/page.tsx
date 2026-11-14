import Link from "next/link";
import { notFound } from "next/navigation";
import { RelatedRecords } from "@/components/records/RelatedRecords";
import { formatMoney, humanize } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { relatedRecords } from "@/server/domain/related";
import { getOrder } from "@/server/domain/quotes";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const id = (await params).id;
  const res = await getOrder(ctx, id);
  if (!res.ok) notFound();
  const related = await relatedRecords(ctx, "order", id);
  const o = res.order;
  return (
    <>
      <h1>{o.name}</h1>
      <p>
        Order {o.orderNumber} · {humanize(o.fulfillmentStatus)}
        {o.quoteId && (
          <>
            {" "}
            · <Link href={`/app/quotes/${o.quoteId}`}>Quote</Link>
          </>
        )}
      </p>
      {related.ok && <RelatedRecords groups={related.groups} />}
      <table className="crm-grid">
        <caption className="crm-sr">Order lines</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Description</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {res.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNumber}</td>
              <td>{l.description}</td>
              <td>{l.quantityMilli / 1000}</td>
              <td>{formatMoney(l.unitPriceCents)}</td>
              <td>{formatMoney(l.extendedCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="crm-header" style={{ justifyContent: "flex-end" }}>
        {[
          ["Subtotal", o.subtotalCents],
          ["Discount", -o.discountCents],
          ["Freight", o.freightCents],
          ["Tax", o.taxCents],
          ["Total", o.totalCents],
        ].map(([label, v]) => (
          <div key={label as string}>
            <dt>{label}</dt>
            <dd>{formatMoney(v as number)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
