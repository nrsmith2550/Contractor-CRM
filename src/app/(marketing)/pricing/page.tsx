import type { Metadata } from "next";
import Link from "next/link";
import "../../crm.css";
import {
  AREAS,
  AREA_CONTENT,
  EDITIONS,
  PLANS,
  SHARED_CONTENT,
  USERS_INCLUDED,
  formatPlanUsd,
} from "@/lib/plans";

export const metadata: Metadata = { title: "Pricing" };

/** Plans and prices. There is no checkout: you buy by getting in touch, and a licence key is issued. */
export default function PricingPage() {
  const support = process.env.SUPPORT_EMAIL;
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 16px" }}>
      <h1>Pricing</h1>
      <p>
        A one-off setup fee, then a flat monthly price for your whole team: up to {USERS_INCLUDED}{" "}
        people signing in.
      </p>
      <div className="crm-related-grid" style={{ margin: "24px 0" }}>
        {EDITIONS.map((e) => {
          const p = PLANS[e];
          return (
            <section key={e} className="crm-related-group" aria-labelledby={`plan-${e}`}>
              <h2 id={`plan-${e}`} style={{ margin: 0, fontSize: 20 }}>
                {p.name}
              </h2>
              <p className="crm-muted">{p.tagline}</p>
              <p style={{ margin: "8px 0" }}>
                <strong style={{ fontSize: 28 }}>{formatPlanUsd(p.monthlyCents)}</strong> a month
                <br />
                <span className="crm-muted">
                  plus a {formatPlanUsd(p.setupCents)} setup fee, once
                </span>
              </p>
              <ul>
                {AREAS.filter((a) => p.areas.includes(a)).map((a) => (
                  <li key={a}>
                    <strong>{AREA_CONTENT[a].name}:</strong> {AREA_CONTENT[a].covers.join(", ")}
                  </li>
                ))}
                <li>
                  <strong>In every plan:</strong> {SHARED_CONTENT.slice(0, 4).join(", ")}, and more
                </li>
              </ul>
            </section>
          );
        })}
      </div>
      <p>
        {support ? (
          <a className="crm-btn crm-btn-primary" href={`mailto:${support}?subject=Clinch CRM`}>
            Get in touch
          </a>
        ) : null}{" "}
        <Link className="crm-btn" href="/activate">
          I have a licence key
        </Link>{" "}
        <Link className="crm-btn" href="/login">
          Sign in
        </Link>
      </p>
    </main>
  );
}
