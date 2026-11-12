"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/format";
import type { CmdResult } from "@/server/actions/entities";
import {
  addOpportunityLineAction,
  removeOpportunityLineAction,
} from "@/server/actions/opportunity-lines";
import { InlineForm } from "./InlineForm";

export type OppLineView = {
  id: string;
  lineNumber: number;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  discountCents: number;
  extendedCents: number;
};

/** Products on an opportunity. Their total becomes the opportunity's estimated revenue. */
export function OpportunityLines(props: {
  opportunityId: string;
  lines: OppLineView[];
  products: { id: string; label: string }[];
  editable: boolean;
}) {
  const { opportunityId, lines, products, editable } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<CmdResult | null>(null);
  const total = lines.reduce((s, l) => s + l.extendedCents, 0);

  return (
    <section aria-label="Products">
      <h2>Products</h2>
      {lines.length > 0 && (
        <p>Estimated revenue is calculated from these lines: {formatMoney(total)}.</p>
      )}
      <table className="crm-grid">
        <caption className="crm-sr">Opportunity products</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Description</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Discount</th>
            <th scope="col">Amount</th>
            {editable && <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={7}>No products yet. Add some to calculate the estimated revenue.</td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNumber}</td>
              <td>{l.description}</td>
              <td>{l.quantityMilli / 1000}</td>
              <td>{formatMoney(l.unitPriceCents)}</td>
              <td>{l.discountCents ? formatMoney(l.discountCents) : ""}</td>
              <td>{formatMoney(l.extendedCents)}</td>
              {editable && (
                <td>
                  <button
                    className="crm-btn"
                    disabled={pending}
                    aria-label={`Remove product ${l.lineNumber}`}
                    onClick={() =>
                      start(async () => {
                        const r = await removeOpportunityLineAction(opportunityId, l.id);
                        setErr(r.ok ? null : r);
                        if (r.ok) router.refresh();
                      })
                    }
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {err && !err.ok && (
        <div role="alert" className="crm-error">
          {err.message}
        </div>
      )}
      {editable && (
        <InlineForm
          submitLabel="Add product"
          action={(v) => addOpportunityLineAction(opportunityId, v)}
          fields={[
            {
              name: "productId",
              label: "Product",
              type: "select",
              options: [
                { value: "", label: "Write-in (no product)" },
                ...products.map((p) => ({ value: p.id, label: p.label })),
              ],
            },
            { name: "description", label: "Description", placeholder: "Needed for write-ins" },
            { name: "quantity", label: "Quantity", defaultValue: "1", inputMode: "decimal" },
            {
              name: "unitPrice",
              label: "Unit price ($)",
              placeholder: "List price",
              inputMode: "decimal",
            },
            { name: "discount", label: "Discount ($)", inputMode: "decimal" },
          ]}
        />
      )}
    </section>
  );
}
