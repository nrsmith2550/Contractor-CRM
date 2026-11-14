"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { setCancelAction } from "@/server/actions/billing";

/** Stop renewing at the end of the paid period, or change your mind. Nothing is cut short. */
export function CancelControls({
  cancelAtPeriodEnd,
  endsOn,
}: {
  cancelAtPeriodEnd: boolean;
  endsOn: string | null;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(cancel: boolean) {
    setBusy(true);
    setError(null);
    const r = await setCancelAction(cancel).catch(() => null);
    setBusy(false);
    if (!r) setError("Something went wrong. Please try again.");
    else if (!r.ok) setError(r.message);
    else {
      setAsking(false);
      router.refresh();
    }
  }

  return (
    <div>
      {cancelAtPeriodEnd ? (
        <>
          <p>
            Your plan will end{endsOn ? ` on ${endsOn}` : " at the end of the paid period"}. Until
            then everything keeps working. After that, nobody in your business can sign in.
          </p>
          <button
            type="button"
            className="crm-btn crm-btn-primary"
            onClick={() => run(false)}
            disabled={busy}
          >
            {busy ? "Working…" : "Keep my plan"}
          </button>
        </>
      ) : asking ? (
        <div role="group" aria-labelledby="cancel-ask">
          <p id="cancel-ask">
            <strong>Cancel your plan?</strong> You keep everything until{" "}
            {endsOn ?? "the end of the paid period"}, then nobody can sign in. Your data is kept so
            you can come back. The setup fee is not refunded.
          </p>
          <div className="billing-actions">
            <button type="button" className="crm-btn" onClick={() => run(true)} disabled={busy}>
              {busy ? "Working…" : "Yes, cancel at the end of the period"}
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              onClick={() => setAsking(false)}
              disabled={busy}
            >
              No, keep my plan
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="crm-muted">
            You can stop at any time. You keep everything until the end of the period you have paid
            for.
          </p>
          <button type="button" className="crm-btn" onClick={() => setAsking(true)}>
            Cancel my plan
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </div>
  );
}
