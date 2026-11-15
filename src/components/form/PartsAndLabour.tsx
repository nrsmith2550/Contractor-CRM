"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/format";
import type { CmdResult } from "@/server/actions/entities";
import {
  addLabourAction,
  addPartAction,
  removeLabourAction,
  removePartAction,
} from "@/server/actions/work-order-lines";
import { InlineForm } from "./InlineForm";

export type PartView = {
  id: string;
  lineNumber: number;
  /** "Phase 2: Install", or null when the part is for the job as a whole. */
  phaseLabel?: string | null;
  description: string;
  quantityMilli: number;
  unitPriceCents: number;
  extendedCents: number;
};
export type LabourView = {
  id: string;
  lineNumber: number;
  phaseLabel?: string | null;
  description: string;
  minutes: number;
  hourlyRateCents: number;
  extendedCents: number;
  resourceName: string | null;
};

/** Parts and labour used on a work order, with their totals (they feed an invoice later). */
export function PartsAndLabour(props: {
  workOrderId: string;
  editable: boolean; // false once posted or cancelled
  canLabour: boolean; // dispatchers set labour rates
  parts: PartView[];
  labour: LabourView[];
  products: { id: string; label: string }[];
  resources: { id: string; name: string }[];
  /** The job's phases a line can be recorded against (cancelled ones left out). */
  phases?: { id: string; label: string }[];
  /** Totals split by phase, so each phase shows what it cost. */
  phaseTotals?: { label: string; cents: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<CmdResult | null>(null);
  const phases = props.phases ?? [];
  const hasPhases =
    phases.length > 0 ||
    props.parts.some((x) => x.phaseLabel) ||
    props.labour.some((x) => x.phaseLabel);
  const phaseField = {
    name: "phaseId",
    label: "For",
    type: "select" as const,
    options: [
      { value: "", label: "The whole job" },
      ...phases.map((ph) => ({ value: ph.id, label: ph.label })),
    ],
  };
  const partsTotal = props.parts.reduce((s, p) => s + p.extendedCents, 0);
  const labourTotal = props.labour.reduce((s, l) => s + l.extendedCents, 0);

  const remove = (fn: () => Promise<CmdResult>) =>
    start(async () => {
      const r = await fn();
      setErr(r.ok ? null : r);
      if (r.ok) router.refresh();
    });

  return (
    <section aria-label="Parts and labour">
      <h2>Parts and labour</h2>

      <table className="crm-grid">
        <caption className="crm-sr">Parts used</caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            {hasPhases && <th scope="col">For</th>}
            <th scope="col">Qty</th>
            <th scope="col">Price</th>
            <th scope="col">Amount</th>
            {props.editable && (
              <th scope="col">
                <span className="crm-sr">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {props.parts.length === 0 && (
            <tr>
              <td colSpan={hasPhases ? 6 : 5}>No parts recorded.</td>
            </tr>
          )}
          {props.parts.map((p) => (
            <tr key={p.id}>
              <td>{p.description}</td>
              {hasPhases && <td>{p.phaseLabel ?? "Whole job"}</td>}
              <td>{p.quantityMilli / 1000}</td>
              <td>{formatMoney(p.unitPriceCents)}</td>
              <td>{formatMoney(p.extendedCents)}</td>
              {props.editable && (
                <td>
                  <button
                    className="crm-btn"
                    disabled={pending}
                    aria-label={`Remove part ${p.lineNumber}`}
                    onClick={() => remove(() => removePartAction(props.workOrderId, p.id))}
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {props.editable && (
        <InlineForm
          submitLabel="Add part"
          action={(v) => addPartAction(props.workOrderId, v)}
          fields={[
            ...(phases.length > 0 ? [phaseField] : []),
            {
              name: "productId",
              label: "Product or service",
              type: "select",
              options: [
                { value: "", label: "Write-in (not in your list)" },
                ...props.products.map((p) => ({ value: p.id, label: p.label })),
              ],
            },
            { name: "description", label: "Description", placeholder: "Needed for write-ins" },
            { name: "quantity", label: "Quantity", defaultValue: "1", inputMode: "decimal" },
            {
              name: "unitPrice",
              label: "Price ($)",
              placeholder: "List price",
              inputMode: "decimal",
            },
          ]}
        />
      )}

      <table className="crm-grid">
        <caption className="crm-sr">Labour</caption>
        <thead>
          <tr>
            <th scope="col">Work</th>
            {hasPhases && <th scope="col">For</th>}
            <th scope="col">Who</th>
            <th scope="col">Minutes</th>
            <th scope="col">Rate / hour</th>
            <th scope="col">Amount</th>
            {props.editable && props.canLabour && (
              <th scope="col">
                <span className="crm-sr">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {props.labour.length === 0 && (
            <tr>
              <td colSpan={hasPhases ? 7 : 6}>No labour recorded.</td>
            </tr>
          )}
          {props.labour.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              {hasPhases && <td>{l.phaseLabel ?? "Whole job"}</td>}
              <td>{l.resourceName ?? ""}</td>
              <td>{l.minutes}</td>
              <td>{formatMoney(l.hourlyRateCents)}</td>
              <td>{formatMoney(l.extendedCents)}</td>
              {props.editable && props.canLabour && (
                <td>
                  <button
                    className="crm-btn"
                    disabled={pending}
                    aria-label={`Remove labour ${l.lineNumber}`}
                    onClick={() => remove(() => removeLabourAction(props.workOrderId, l.id))}
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {props.editable && props.canLabour && (
        <InlineForm
          submitLabel="Add labour"
          action={(v) => addLabourAction(props.workOrderId, v)}
          fields={[
            ...(phases.length > 0 ? [phaseField] : []),
            { name: "description", label: "Work done", defaultValue: "Labour" },
            {
              name: "resourceId",
              label: "Who",
              type: "select",
              options: [
                { value: "", label: "Anyone" },
                ...props.resources.map((r) => ({ value: r.id, label: r.name })),
              ],
            },
            { name: "minutes", label: "Minutes", inputMode: "decimal" },
            { name: "rate", label: "Hourly rate ($)", inputMode: "decimal" },
          ]}
        />
      )}

      {err && !err.ok && (
        <div role="alert" className="crm-error">
          {err.message}
        </div>
      )}
      <dl className="crm-header" aria-label="Job totals" style={{ justifyContent: "flex-end" }}>
        {(
          [
            ["Parts", partsTotal],
            ["Labour", labourTotal],
            ["Total", partsTotal + labourTotal],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatMoney(v)}</dd>
          </div>
        ))}
      </dl>
      {props.phaseTotals && props.phaseTotals.length > 0 && (
        <dl
          className="crm-header"
          aria-label="Totals by phase"
          style={{ justifyContent: "flex-end" }}
        >
          {props.phaseTotals.map((t) => (
            <div key={t.label}>
              <dt>{t.label}</dt>
              <dd>{formatMoney(t.cents)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
