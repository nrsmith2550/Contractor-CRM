"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  EDITIONS,
  MAX_SELF_SERVE_USERS,
  PLANS,
  USERS_INCLUDED,
  formatPlanUsd,
  type Edition,
} from "@/lib/plans";
import { changePlanAction, previewPlanChangeAction } from "@/server/actions/billing";
import type { ChangePreview } from "@/server/billing/account";

type Current = { edition: Edition; extraUsers: number };

/** Pick a plan and a number of people, see what it costs, then confirm. Nothing changes until then. */
export function ChangePlan({ current, activeUsers }: { current: Current; activeUsers: number }) {
  const router = useRouter();
  const [edition, setEdition] = useState<Edition>(current.edition);
  const [peopleText, setPeopleText] = useState(String(USERS_INCLUDED + current.extraUsers));
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const n = Number(peopleText);
  const floor = Math.max(USERS_INCLUDED, activeUsers);
  const valid =
    peopleText.trim() !== "" && Number.isInteger(n) && n >= floor && n <= MAX_SELF_SERVE_USERS;
  const unchanged = edition === current.edition && n - USERS_INCLUDED === current.extraUsers;
  const choice = { edition, extraUsers: valid ? n - USERS_INCLUDED : 0 };

  const touch = () => {
    setPreview(null);
    setMessage(null);
  };

  async function see() {
    if (!valid || unchanged || busy) return;
    setBusy(true);
    setMessage(null);
    const r = await previewPlanChangeAction(choice).catch(() => null);
    setBusy(false);
    if (!r) setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    else if (!r.ok) setMessage({ kind: "error", text: r.message });
    else setPreview(r.preview);
  }

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const r = await changePlanAction(choice).catch(() => null);
    setBusy(false);
    if (!r) {
      setMessage({ kind: "error", text: "Something went wrong. Please try again." });
    } else if (!r.ok) {
      setMessage({ kind: "error", text: r.message });
    } else {
      setPreview(null);
      setMessage({ kind: "ok", text: "Done. Your plan has been updated." });
      router.refresh();
    }
  }

  return (
    <div>
      <fieldset className="billing-plans">
        <legend>Plan</legend>
        {EDITIONS.map((e) => (
          <label key={e} className="billing-plan">
            <input
              type="radio"
              name="plan"
              value={e}
              checked={edition === e}
              onChange={() => {
                setEdition(e);
                touch();
              }}
            />
            <span>
              <strong>{PLANS[e].name}</strong>
              {e === current.edition ? " (your plan)" : ""}
              <br />
              <span className="crm-muted">
                {formatPlanUsd(PLANS[e].monthlyCents)} a month,{" "}
                {formatPlanUsd(PLANS[e].extraUserCents)} for each person over {USERS_INCLUDED}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="billing-people">
        <label htmlFor="bill-people">People who can sign in</label>
        <input
          id="bill-people"
          type="number"
          inputMode="numeric"
          min={floor}
          max={MAX_SELF_SERVE_USERS}
          value={peopleText}
          onChange={(e) => {
            setPeopleText(e.target.value);
            touch();
          }}
          aria-describedby="bill-people-hint"
          aria-invalid={!valid}
        />
        <p id="bill-people-hint" className="crm-muted">
          {activeUsers} signed up now, so at least {floor}. Up to {MAX_SELF_SERVE_USERS}; for more,
          get in touch.
        </p>
      </div>

      {preview ? (
        <div className="billing-preview" role="status">
          <h3>What this changes</h3>
          <ul>
            <li>
              {preview.dueNowCents > 0 ? (
                <>
                  You pay <strong>{formatPlanUsd(preview.dueNowCents)}</strong> now
                  {preview.setupDifferenceCents > 0
                    ? `, which includes ${formatPlanUsd(preview.setupDifferenceCents)} for the difference in setup fee`
                    : ", for the rest of this month"}
                  .
                </>
              ) : preview.creditCents > 0 ? (
                <>
                  You pay nothing now and get a{" "}
                  <strong>{formatPlanUsd(preview.creditCents)}</strong> credit off your next bill.
                </>
              ) : (
                <>You pay nothing now.</>
              )}
            </li>
            <li>
              From your next bill:{" "}
              <strong>{formatPlanUsd(preview.nextMonthlyCents)} a month</strong> for up to{" "}
              {preview.seats} people.
            </li>
          </ul>
          <div className="billing-actions">
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              onClick={confirm}
              disabled={busy}
            >
              {busy ? "Working…" : "Confirm change"}
            </button>
            <button type="button" className="crm-btn" onClick={touch} disabled={busy}>
              Not now
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          onClick={see}
          disabled={!valid || unchanged || busy}
        >
          {busy ? "Working…" : "See what this costs"}
        </button>
      )}

      {!valid && (
        <p role="alert" className="crm-error">
          Enter a whole number from {floor} to {MAX_SELF_SERVE_USERS}.
        </p>
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
