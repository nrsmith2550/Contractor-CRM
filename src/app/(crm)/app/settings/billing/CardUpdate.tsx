"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { beginCardUpdateAction, completeCardUpdateAction } from "@/server/actions/billing";

type Card = { brand: string; last4: string; expMonth: number; expYear: number };

const brandName = (b: string) => b.charAt(0).toUpperCase() + b.slice(1);

/** The card on file, and a form drawn right here to replace it. */
export function CardUpdate({
  card,
  pastDue,
  publishableKey,
}: {
  card: Card | null;
  pastDue: boolean;
  publishableKey: string | null;
}) {
  const router = useRouter();
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function start() {
    setBusy(true);
    setMessage(null);
    const r = await beginCardUpdateAction().catch(() => null);
    setBusy(false);
    if (!r) setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    else if (!r.ok) setMessage({ kind: "error", text: r.message });
    else setClientSecret(r.clientSecret);
  }

  return (
    <div>
      <p>
        {card ? (
          <>
            {brandName(card.brand)} ending <strong>{card.last4}</strong>, expires{" "}
            {String(card.expMonth).padStart(2, "0")}/{card.expYear}
          </>
        ) : (
          "No card on file."
        )}
      </p>

      {!publishableKey ? (
        <p className="crm-muted">Updating the card online is not switched on yet.</p>
      ) : clientSecret && stripePromise ? (
        <Elements stripe={stripePromise} options={{ clientSecret }}>
          <CardForm
            pastDue={pastDue}
            onCancel={() => setClientSecret(null)}
            onDone={(text) => {
              setClientSecret(null);
              setMessage({ kind: "ok", text });
              router.refresh();
            }}
          />
        </Elements>
      ) : (
        <button type="button" className="crm-btn" onClick={start} disabled={busy}>
          {busy ? "One moment…" : card ? "Update card" : "Add a card"}
        </button>
      )}

      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={message.kind === "error" ? "crm-error" : undefined}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function CardForm({
  pastDue,
  onDone,
  onCancel,
}: {
  pastDue: boolean;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || busy) return;
    setBusy(true);
    setError(null);
    // "if_required" keeps the person on this page unless their bank insists on its own check.
    const res = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (res.error) {
      setBusy(false);
      setError(res.error.message ?? "That card could not be saved. Please check it and try again.");
      return;
    }
    const saved = await completeCardUpdateAction(res.setupIntent.id).catch(() => null);
    setBusy(false);
    if (!saved) setError("Something went wrong. Please try again.");
    else if (!saved.ok) setError(saved.message);
    else
      onDone(
        saved.retriedOverdue
          ? "Card updated, and your overdue payment has been collected."
          : pastDue
            ? "Card updated. We will try your overdue payment again shortly."
            : "Card updated.",
      );
  }

  return (
    <form onSubmit={submit} className="billing-card-form">
      <PaymentElement />
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      <div className="billing-actions">
        <button type="submit" className="crm-btn crm-btn-primary" disabled={!stripe || busy}>
          {busy ? "Saving…" : "Save card"}
        </button>
        <button type="button" className="crm-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
