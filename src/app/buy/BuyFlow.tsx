"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EDITIONS,
  MAX_SELF_SERVE_USERS,
  PLANS,
  USERS_INCLUDED,
  dueTodayCents,
  formatPlanUsd,
  monthlyCentsFor,
  type Edition,
} from "@/lib/plans";
import { LEGAL } from "@/lib/legal";
import { createCheckoutSessionAction } from "@/server/actions/billing";

type Step = "choose" | "pay" | "done";

const ERRORS = {
  invalid: "Please check the plan and the number of people, then try again.",
  unavailable: "Online ordering is not switched on yet.",
  busy: "Too many attempts from your connection. Please try again in a little while.",
  failed: "We could not start the payment form. Please try again.",
} as const;

/** Whole people between the included number and the most that can be bought on the site. */
const clampPeople = (n: number) =>
  Math.min(MAX_SELF_SERVE_USERS, Math.max(USERS_INCLUDED, Math.round(n)));

export function BuyFlow({
  publishableKey,
  testMode,
  support,
  initialEdition,
  initialPeople,
}: {
  publishableKey: string | null;
  testMode: boolean;
  support: string | undefined;
  initialEdition: Edition;
  initialPeople: number;
}) {
  const [edition, setEdition] = useState<Edition>(initialEdition);
  const [peopleText, setPeopleText] = useState(String(initialPeople));
  const [step, setStep] = useState<Step>("choose");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const payHeading = useRef<HTMLHeadingElement>(null);

  const parsed = Number(peopleText);
  const peopleValid =
    peopleText.trim() !== "" &&
    Number.isInteger(parsed) &&
    parsed >= USERS_INCLUDED &&
    parsed <= MAX_SELF_SERVE_USERS;
  const people = peopleValid ? parsed : USERS_INCLUDED;
  const extraUsers = people - USERS_INCLUDED;
  const plan = PLANS[edition];

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );
  const options = useMemo(
    () => ({
      fetchClientSecret: async () => clientSecret ?? "",
      onComplete: () => setStep("done"),
    }),
    [clientSecret],
  );

  // Move keyboard and screen reader focus to the new step's heading.
  useEffect(() => {
    if (step === "done") doneHeading.current?.focus();
    if (step === "pay") payHeading.current?.focus();
  }, [step]);

  if (!publishableKey) {
    const mail = support
      ? `mailto:${support}?subject=${encodeURIComponent(`${plan.name} enquiry`)}`
      : null;
    return (
      <section className="mk-buy-card" aria-labelledby="buy-off">
        <h2 id="buy-off">Online ordering is not switched on yet</h2>
        <p>
          You can still get started: get in touch and we will set up your business and send you your
          licence key.
        </p>
        {mail ? (
          <a className="mk-btn mk-btn-primary" href={mail}>
            Get in touch
          </a>
        ) : (
          <p className="mk-muted">Contact us using the details on the home page.</p>
        )}
      </section>
    );
  }

  if (step === "done") {
    return (
      <section className="mk-buy-card" aria-labelledby="buy-done" role="status">
        <h2 id="buy-done" tabIndex={-1} ref={doneHeading}>
          Thank you, your payment went through
        </h2>
        <p>
          We are emailing your <strong>{plan.name}</strong> licence key to the address you gave at
          checkout. It usually arrives within a minute. Keep that email: for security the key cannot
          be shown again.
        </p>
        <p>
          When it arrives, open <Link href="/activate">the activation page</Link>, enter the key and
          create your business and your owner sign-in.
        </p>
        <p className="mk-muted">
          No email after ten minutes? Check your spam folder
          {support ? (
            <>
              , then write to <a href={`mailto:${support}`}>{support}</a>
            </>
          ) : null}
          .
        </p>
      </section>
    );
  }

  async function startPayment() {
    if (!peopleValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createCheckoutSessionAction({ edition, extraUsers });
      if (res.ok) {
        setClientSecret(res.clientSecret);
        setStep("pay");
      } else {
        setError(ERRORS[res.error]);
      }
    } catch {
      setError(ERRORS.failed);
    } finally {
      setBusy(false);
    }
  }

  const summary = (
    <aside className="mk-buy-summary" aria-labelledby="buy-summary">
      <h2 id="buy-summary">Your order</h2>
      <dl>
        <div>
          <dt>{plan.name}</dt>
          <dd>{formatPlanUsd(plan.monthlyCents)} a month</dd>
        </div>
        {extraUsers > 0 && (
          <div>
            <dt>
              {extraUsers} extra {extraUsers === 1 ? "person" : "people"} at{" "}
              {formatPlanUsd(plan.extraUserCents)}
            </dt>
            <dd>{formatPlanUsd(extraUsers * plan.extraUserCents)} a month</dd>
          </div>
        )}
        <div>
          <dt>One-time setup fee</dt>
          <dd>{formatPlanUsd(plan.setupCents)}</dd>
        </div>
        <div className="mk-buy-total">
          <dt>Due today</dt>
          <dd>{formatPlanUsd(dueTodayCents(edition, extraUsers))}</dd>
        </div>
        <div>
          <dt>Then every month</dt>
          <dd>{formatPlanUsd(monthlyCentsFor(edition, extraUsers))}</dd>
        </div>
      </dl>
      <p className="mk-muted">
        Up to {people} people can sign in. US dollars. Cancel any time from the Billing page inside
        Gantry.
      </p>
    </aside>
  );

  return (
    <div className="mk-buy-grid">
      <div>
        {testMode && (
          <p className="mk-buy-test" role="note">
            <strong>Test mode.</strong> No real money moves. Pay with the test card 4242 4242 4242
            4242, any future date and any three digits.
          </p>
        )}

        {step === "choose" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void startPayment();
            }}
            noValidate
          >
            <fieldset className="mk-buy-plans">
              <legend>1. Choose your plan</legend>
              {EDITIONS.map((e) => (
                <label key={e} className="mk-buy-plan">
                  <input
                    type="radio"
                    name="plan"
                    value={e}
                    checked={edition === e}
                    onChange={() => setEdition(e)}
                  />
                  <span className="mk-buy-plan-name">{PLANS[e].name}</span>
                  <span className="mk-muted">{PLANS[e].tagline}</span>
                  <span>
                    {formatPlanUsd(PLANS[e].monthlyCents)} a month, plus{" "}
                    {formatPlanUsd(PLANS[e].setupCents)} setup
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="mk-buy-people">
              <label htmlFor="buy-people">
                <strong>2. How many people will sign in?</strong>
              </label>
              <p id="buy-people-hint" className="mk-muted">
                {USERS_INCLUDED} are included. Each extra person is{" "}
                {formatPlanUsd(plan.extraUserCents)} a month on {plan.name}, up to{" "}
                {MAX_SELF_SERVE_USERS} people.
              </p>
              <input
                id="buy-people"
                type="number"
                inputMode="numeric"
                min={USERS_INCLUDED}
                max={MAX_SELF_SERVE_USERS}
                step={1}
                value={peopleText}
                onChange={(e) => setPeopleText(e.target.value)}
                onBlur={() => {
                  if (peopleText.trim() !== "" && Number.isFinite(parsed)) {
                    setPeopleText(String(clampPeople(parsed)));
                  } else {
                    setPeopleText(String(USERS_INCLUDED));
                  }
                }}
                aria-describedby="buy-people-hint"
                aria-invalid={!peopleValid}
              />
              {!peopleValid && (
                <p role="alert" className="mk-buy-error">
                  Enter a whole number from {USERS_INCLUDED} to {MAX_SELF_SERVE_USERS}. Need more
                  than {MAX_SELF_SERVE_USERS}?{" "}
                  {support ? (
                    <a href={`mailto:${support}?subject=${encodeURIComponent("A larger team")}`}>
                      Get in touch for a quote
                    </a>
                  ) : (
                    "Get in touch for a quote."
                  )}
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="mk-buy-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="mk-btn mk-btn-primary"
              disabled={!peopleValid || busy}
              aria-busy={busy}
            >
              {busy ? "One moment…" : "3. Continue to payment"}
            </button>
            <p className="mk-muted mk-buy-legal">
              By paying you agree to our <Link href="/terms">Terms of Service</Link> and{" "}
              <Link href="/privacy">Privacy Policy</Link>. Not happy? You have a {LEGAL.refundDays}
              -day money-back guarantee.
            </p>
          </form>
        ) : (
          <section aria-labelledby="buy-pay">
            <h2 id="buy-pay" tabIndex={-1} ref={payHeading}>
              3. Pay for {plan.name}
            </h2>
            <p className="mk-muted">
              Your card details go straight to our payment provider and never touch our servers.
            </p>
            <div className="mk-buy-checkout">
              {stripePromise && clientSecret && (
                <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
                  <EmbeddedCheckout />
                </EmbeddedCheckoutProvider>
              )}
            </div>
            <button
              type="button"
              className="mk-btn"
              onClick={() => {
                setStep("choose");
                setClientSecret(null);
              }}
            >
              Change plan or people
            </button>
          </section>
        )}
      </div>
      {summary}
    </div>
  );
}
