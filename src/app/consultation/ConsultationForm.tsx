"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BEST_TIMES,
  TEAM_SIZES,
  TIME_ZONES,
  TRADES,
  consultationSchema,
} from "@/lib/consultation";
import { requestConsultationAction } from "@/server/actions/consultation";

type Errors = Record<string, string>;

/** Best guess at the visitor's US time zone; they can change it. */
function guessZone(): string {
  try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIME_ZONES.some(([v]) => v === z)) return z;
    if (z === "America/Detroit" || z === "America/Indiana/Indianapolis") return "America/New_York";
    if (z === "America/Boise") return "America/Denver";
  } catch {
    /* fall through */
  }
  return "America/New_York";
}

export function ConsultationForm({ supportEmail }: { supportEmail: string }) {
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string } | null>(null);
  const [zone, setZone] = useState("America/New_York");
  const thanks = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => setZone(guessZone()), []);
  useEffect(() => {
    if (done) thanks.current?.focus();
  }, [done]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setFormError("");
    const check = consultationSchema.safeParse(data);
    if (!check.success) {
      const next: Errors = {};
      for (const issue of check.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      setFormError("Please fix the highlighted fields.");
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await requestConsultationAction(data);
      if (res.ok) {
        setDone({ email: check.data.email });
      } else {
        setErrors(res.errors ?? {});
        setFormError(res.message);
        requestAnimationFrame(() => summary.current?.focus());
      }
    } catch {
      setFormError(`Something went wrong. Please try again, or email ${supportEmail}.`);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="mk-consult-done" aria-live="polite">
        <h2 ref={thanks} tabIndex={-1}>
          Thank you, we got your request
        </h2>
        <p>
          We will phone you, usually within two business days, to agree a time. A confirmation is on
          its way to {done.email}.
        </p>
        <p>
          <Link className="mk-btn" href="/">
            Back to the home page
          </Link>
        </p>
      </section>
    );
  }

  const field = (name: string) => ({
    id: `c-${name}`,
    name,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `c-${name}-err` : undefined,
  });
  const err = (name: string) =>
    errors[name] ? (
      <span id={`c-${name}-err`} className="mk-field-error">
        {errors[name]}
      </span>
    ) : null;
  const select = (
    name: string,
    label: string,
    list: readonly (readonly [string, string])[],
    controlled?: { value: string; onChange: (v: string) => void },
  ) => (
    <div className="mk-field">
      <label htmlFor={`c-${name}`}>{label}</label>
      <select
        {...field(name)}
        required
        {...(controlled
          ? { value: controlled.value, onChange: (ev) => controlled.onChange(ev.target.value) }
          : { defaultValue: "" })}
      >
        {controlled ? null : (
          <option value="" disabled>
            Choose one
          </option>
        )}
        {list.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {err(name)}
    </div>
  );

  return (
    <form className="mk-form" onSubmit={submit} noValidate>
      {formError ? (
        <div ref={summary} tabIndex={-1} role="alert" className="mk-form-error">
          {formError}
        </div>
      ) : null}

      <div className="mk-field">
        <label htmlFor="c-name">Your name</label>
        <input {...field("name")} autoComplete="name" required />
        {err("name")}
      </div>
      <div className="mk-field">
        <label htmlFor="c-business">Business name</label>
        <input {...field("business")} autoComplete="organization" required />
        {err("business")}
      </div>
      <div className="mk-field">
        <label htmlFor="c-email">Email</label>
        <input {...field("email")} type="email" autoComplete="email" required />
        {err("email")}
      </div>
      <div className="mk-field">
        <label htmlFor="c-phone">Phone number</label>
        <input {...field("phone")} type="tel" autoComplete="tel" required />
        <span className="mk-hint">We will call this number, so include the area code.</span>
        {err("phone")}
      </div>

      {select("trade", "Your trade", TRADES)}
      {select("teamSize", "Team size", TEAM_SIZES)}
      {select("bestTime", "Best time to call", BEST_TIMES)}
      {select("timeZone", "Your time zone", TIME_ZONES, { value: zone, onChange: setZone })}

      <div className="mk-field">
        <label htmlFor="c-message">Anything you want us to know? (optional)</label>
        <textarea {...field("message")} rows={4} maxLength={1000} />
        {err("message")}
      </div>

      {/* Bot trap: hidden from people and from assistive technology. */}
      <div className="mk-trap" aria-hidden="true">
        <label htmlFor="c-website">Website</label>
        <input id="c-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <p className="mk-muted">
        By sending this you agree we may phone and email you about your enquiry. We use your details
        only for that. See our <Link href="/privacy">Privacy Policy</Link>.
      </p>
      <button type="submit" className="mk-btn mk-btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Request a consultation"}
      </button>
    </form>
  );
}
