"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney, humanize } from "@/lib/format";
import type { CmdResult } from "@/server/actions/entities";
import {
  addLineAction,
  emailQuoteAction,
  quoteCommandAction,
  removeLineAction,
  updateQuoteAction,
} from "@/server/actions/quotes";
import { InlineForm } from "./InlineForm";

export type QuoteView = {
  id: string;
  quoteNumber: string;
  name: string;
  status: string;
  opportunityId: string | null;
  paymentTerms: string;
  termsText: string;
  freightCents: number;
  discountPercentBp: number | null;
  discountAmountCents: number | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};
export type LineView = {
  id: string;
  lineNumber: number;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  discountCents: number;
  taxRateBp: number;
  extendedCents: number;
};
export type ProductOption = { id: string; label: string };

const dollars = (c: number) => (c / 100).toFixed(2);

/** The quote form: header, editable line items (drafts only), live totals and lifecycle commands. */
export function QuoteBuilder(props: {
  quote: QuoteView;
  lines: LineView[];
  products: ProductOption[];
  defaultTo?: string;
}) {
  const { quote: q, lines, products } = props;
  const [emailing, setEmailing] = useState(false);
  const router = useRouter();
  const draft = q.status === "draft";
  const [pending, start] = useTransition();
  const [res, setRes] = useState<CmdResult | null>(null);
  const [closeOpp, setCloseOpp] = useState(true);
  const [h, setH] = useState({
    name: q.name,
    paymentTerms: q.paymentTerms,
    termsText: q.termsText,
    freight: q.freightCents ? dollars(q.freightCents) : "",
    discountKind:
      q.discountPercentBp != null ? "percent" : q.discountAmountCents != null ? "amount" : "none",
    discountValue:
      q.discountPercentBp != null
        ? String(q.discountPercentBp / 100)
        : q.discountAmountCents != null
          ? dollars(q.discountAmountCents)
          : "",
  });

  const run = (fn: () => Promise<CmdResult>) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      if (r.ok) {
        if (r.redirectTo) router.push(r.redirectTo);
        else router.refresh();
      }
    });
  const cmd = (c: "activate" | "revise" | "win" | "lose") =>
    run(() => quoteCommandAction(c, q.id, { closeOpportunity: closeOpp }));

  return (
    <div>
      <div className="crm-commandbar" role="toolbar" aria-label="Quote commands">
        <span className="crm-badge">{humanize(q.status)}</span>
        {draft && (
          <button
            className="crm-btn crm-btn-primary"
            disabled={pending}
            onClick={() => cmd("activate")}
          >
            Activate quote
          </button>
        )}
        {q.status === "active" && (
          <>
            <button className="crm-btn" disabled={pending} onClick={() => cmd("revise")}>
              Revise
            </button>
            <button
              className="crm-btn crm-btn-primary"
              disabled={pending}
              onClick={() => cmd("win")}
            >
              Close as won
            </button>
            {q.opportunityId && (
              <label>
                <input
                  type="checkbox"
                  checked={closeOpp}
                  onChange={(e) => setCloseOpp(e.target.checked)}
                />{" "}
                Also close the opportunity as won
              </label>
            )}
            <button className="crm-btn" disabled={pending} onClick={() => cmd("lose")}>
              Close as lost
            </button>
          </>
        )}
        {!draft && q.status !== "revised" && (
          <button
            className="crm-btn"
            type="button"
            aria-expanded={emailing}
            onClick={() => setEmailing((v) => !v)}
          >
            Email quote
          </button>
        )}
        {!draft && (
          <a className="crm-btn" href={`/app/quotes/${q.id}/pdf`} target="_blank" rel="noreferrer">
            Download PDF
          </a>
        )}
        {q.opportunityId && <Link href={`/app/opportunities/${q.opportunityId}`}>Opportunity</Link>}
      </div>
      {res && !res.ok && (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      )}
      {res?.ok && res.message && (
        <div role="status" className="crm-ok">
          {res.message}
        </div>
      )}
      {emailing && (
        <InlineForm
          submitLabel="Send quote"
          resetOnSuccess={false}
          action={(v) => emailQuoteAction(q.id, v)}
          fields={[
            {
              name: "to",
              label: "To",
              placeholder: "customer@example.com",
              defaultValue: props.defaultTo ?? "",
            },
            {
              name: "message",
              label: "Message (optional)",
              type: "textarea",
              placeholder: "Added above the standard text",
            },
          ]}
        />
      )}
      {!draft && (
        <p>This quote is {q.status}, so it can&apos;t be edited. Revise it to make changes.</p>
      )}

      <fieldset className="crm-section" disabled={!draft}>
        <legend>Summary</legend>
        <div className="crm-fields">
          {(
            [
              ["name", "Name"],
              ["paymentTerms", "Payment terms"],
              ["freight", "Freight ($)"],
            ] as const
          ).map(([k, label]) => (
            <div className="crm-field" key={k}>
              <label htmlFor={`q-${k}`}>{label}</label>
              <input
                id={`q-${k}`}
                value={h[k]}
                onChange={(e) => setH({ ...h, [k]: e.target.value })}
              />
            </div>
          ))}
          <div className="crm-field">
            <label htmlFor="q-dk">Quote discount</label>
            <select
              id="q-dk"
              value={h.discountKind}
              onChange={(e) => setH({ ...h, discountKind: e.target.value })}
            >
              <option value="none">None</option>
              <option value="percent">Percent</option>
              <option value="amount">Amount ($)</option>
            </select>
          </div>
          {h.discountKind !== "none" && (
            <div className="crm-field">
              <label htmlFor="q-dv">
                {h.discountKind === "percent" ? "Discount (%)" : "Discount ($)"}
              </label>
              <input
                id="q-dv"
                value={h.discountValue}
                onChange={(e) => setH({ ...h, discountValue: e.target.value })}
              />
            </div>
          )}
          <div className="crm-field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="q-terms">Terms</label>
            <textarea
              id="q-terms"
              rows={3}
              value={h.termsText}
              onChange={(e) => setH({ ...h, termsText: e.target.value })}
            />
          </div>
        </div>
        {draft && (
          <button
            className="crm-btn crm-btn-primary"
            disabled={pending}
            onClick={() => run(() => updateQuoteAction(q.id, h))}
          >
            Save
          </button>
        )}
      </fieldset>

      <h2>Line items</h2>
      <table className="crm-grid">
        <caption className="crm-sr">Quote lines</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Description</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Discount</th>
            <th scope="col">Tax</th>
            <th scope="col">Amount</th>
            {draft && <th scope="col" />}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={8}>No lines yet.</td>
            </tr>
          )}
          {lines.map((l) => (
            <tr key={l.id}>
              <td>{l.lineNumber}</td>
              <td>{l.description}</td>
              <td>{l.quantityMilli / 1000}</td>
              <td>{formatMoney(l.unitPriceCents)}</td>
              <td>{l.discountCents ? formatMoney(l.discountCents) : ""}</td>
              <td>{l.taxRateBp ? `${(l.taxRateBp / 100).toFixed(2)}%` : ""}</td>
              <td>{formatMoney(l.extendedCents)}</td>
              {draft && (
                <td>
                  <button
                    className="crm-btn"
                    disabled={pending}
                    aria-label={`Remove line ${l.lineNumber}`}
                    onClick={() => run(() => removeLineAction(q.id, l.id))}
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {draft && (
        <InlineForm
          submitLabel="Add line"
          action={(v) => addLineAction(q.id, v)}
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
              placeholder: "From price list",
              inputMode: "decimal",
            },
            { name: "discount", label: "Line discount ($)", inputMode: "decimal" },
            {
              name: "taxPercent",
              label: "Tax (%)",
              placeholder: "From product",
              inputMode: "decimal",
            },
          ]}
        />
      )}

      <dl className="crm-header" aria-label="Totals" style={{ justifyContent: "flex-end" }}>
        {[
          ["Subtotal", q.subtotalCents],
          ["Discount", -q.discountCents],
          ["Freight", q.freightCents],
          ["Tax", q.taxCents],
          ["Total", q.totalCents],
        ].map(([label, v]) => (
          <div key={label as string}>
            <dt>{label}</dt>
            <dd>{formatMoney(v as number)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
