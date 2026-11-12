"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { humanize } from "@/lib/format";
import type { CmdResult } from "@/server/actions/entities";
import { bookingStatusAction, type BookingCommand } from "@/server/actions/bookings";
import { addPartAction } from "@/server/actions/work-order-lines";
import { InlineForm } from "./InlineForm";
import { SignaturePad } from "./SignaturePad";

export type MyBooking = {
  id: string;
  workOrderId: string | null;
  parts: { id: string; description: string; quantityMilli: number }[];
  status: string;
  when: string; // already formatted in the business's time zone
  woNumber: string | null;
  woTitle: string | null;
  instructions: string | null;
  address: string[];
  notes: string | null;
  signedByName: string | null;
};

function Card({ b, products }: { b: MyBooking; products: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<CmdResult | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [notes, setNotes] = useState("");
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);

  const go = (
    to: BookingCommand,
    extra: { notes?: string; signatureDataUrl?: string; signedByName?: string } = {},
  ) =>
    start(async () => {
      const r = await bookingStatusAction(b.id, to, extra);
      setRes(r);
      if (r.ok) {
        setFinishing(false);
        router.refresh();
      }
    });
  const big = "crm-btn crm-btn-primary crm-big";

  return (
    <article
      className="crm-card crm-visit"
      aria-label={`${b.woNumber ?? "Visit"} ${b.woTitle ?? ""}`}
    >
      <header className="crm-row" style={{ justifyContent: "space-between" }}>
        <strong>{b.woTitle ?? "Visit"}</strong>
        <span className="crm-badge">{humanize(b.status)}</span>
      </header>
      <div>{b.when}</div>
      {b.woNumber && <div className="crm-muted">{b.woNumber}</div>}
      {b.address.length > 0 && (
        <address style={{ fontStyle: "normal" }}>
          {b.address.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </address>
      )}
      {b.instructions && <p style={{ whiteSpace: "pre-wrap" }}>{b.instructions}</p>}
      {b.notes && (
        <p className="crm-muted" style={{ whiteSpace: "pre-wrap" }}>
          {b.notes}
        </p>
      )}

      {b.status === "scheduled" && (
        <div className="crm-stack">
          <button className={big} disabled={pending} onClick={() => go("travelling")}>
            I&apos;m on my way
          </button>
          <button className="crm-btn crm-big" disabled={pending} onClick={() => go("in_progress")}>
            Start work
          </button>
        </div>
      )}
      {b.status === "travelling" && (
        <div className="crm-stack">
          <button className={big} disabled={pending} onClick={() => go("in_progress")}>
            Start work
          </button>
          <button className="crm-btn crm-big" disabled={pending} onClick={() => go("scheduled")}>
            Not on my way after all
          </button>
        </div>
      )}
      {b.status === "in_progress" && !finishing && (
        <button className={big} disabled={pending} onClick={() => setFinishing(true)}>
          Finish visit
        </button>
      )}
      {b.status === "in_progress" && finishing && (
        <div className="crm-stack" role="group" aria-label="Finish visit">
          <label>
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label>
            Customer name
            <input value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </label>
          <SignaturePad onChange={setSignature} />
          <button
            className={big}
            disabled={pending}
            onClick={() =>
              go("completed", {
                notes,
                signatureDataUrl: signature ?? undefined,
                signedByName: name,
              })
            }
          >
            Complete visit
          </button>
          <p className="crm-muted">
            A signature is optional. If you capture one, enter the customer&apos;s name.
          </p>
        </div>
      )}
      {b.workOrderId && (b.status === "in_progress" || b.status === "completed") && (
        <section aria-label="Parts used">
          <h3>Parts used</h3>
          {b.parts.length === 0 ? (
            <p className="crm-muted">None recorded.</p>
          ) : (
            <ul>
              {b.parts.map((p) => (
                <li key={p.id}>
                  {p.quantityMilli / 1000} × {p.description}
                </li>
              ))}
            </ul>
          )}
          <InlineForm
            submitLabel="Add part"
            action={(v) => addPartAction(b.workOrderId!, { ...v, description: "", unitPrice: "" })}
            fields={[
              {
                name: "productId",
                label: "Part",
                type: "select",
                options: [
                  { value: "", label: "Choose a part" },
                  ...products.map((p) => ({ value: p.id, label: p.label })),
                ],
              },
              { name: "quantity", label: "Quantity", defaultValue: "1", inputMode: "decimal" },
            ]}
          />
        </section>
      )}
      {b.status === "completed" && (
        <p>Completed{b.signedByName ? `. Signed by ${b.signedByName}.` : "."}</p>
      )}
      {res && !res.ok && (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      )}
    </article>
  );
}

export function TechnicianBookings({
  days,
  products,
}: {
  days: { label: string; bookings: MyBooking[] }[];
  products: { id: string; label: string }[];
}) {
  if (days.length === 0) return <p>You have no visits booked in the next week.</p>;
  return (
    <div>
      {days.map((d) => (
        <section key={d.label} aria-label={d.label}>
          <h2>{d.label}</h2>
          <div className="crm-stack">
            {d.bookings.map((b) => (
              <Card key={b.id} b={b} products={products} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
