import type { Metadata } from "next";
import Link from "next/link";
import { formatDate, formatMoney } from "@/lib/format";
import { PLANS, USERS_INCLUDED } from "@/lib/plans";
import { requireUser } from "@/server/auth/http";
import { billingView } from "@/server/billing/manage";
import { buildCtx } from "@/server/domain/context";
import { tenantTimeZone } from "@/server/entities/tenant";
import { can } from "@/server/security/roles";
import { CancelControls } from "./CancelControls";
import { CardUpdate } from "./CardUpdate";
import { ChangePlan } from "./ChangePlan";

export const metadata: Metadata = { title: "Billing" };

// Reads the payment provider's current state on every visit.
export const dynamic = "force-dynamic";

const STATUS_WORDS: Record<string, string> = {
  paid: "Paid",
  open: "Waiting for payment",
  draft: "Draft",
  void: "Cancelled",
  uncollectible: "Not collected",
};

/** What the business pays, how to change it, and its invoices, all without leaving Gantry. */
export default async function BillingPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  if (!can(ctx.subject, "license", "write")) {
    return (
      <>
        <h1>Billing</h1>
        <p>
          Only the person who owns the account, or someone they have given licence access to, can
          see and change billing.
        </p>
      </>
    );
  }

  const [r, tz] = await Promise.all([billingView(ctx), tenantTimeZone(user.tenantId)]);
  if (!r.ok) {
    return (
      <>
        <h1>Billing</h1>
        <p role="status" className="crm-warn">
          {r.message}
        </p>
        <p>
          <Link href="/app/plan">See what is in your plan</Link>
        </p>
      </>
    );
  }

  const { overview: o, invoices, activeUsers, testMode, canUpdateCard } = r.view;
  const plan = PLANS[o.edition];
  const renews = o.periodEnd ? formatDate(o.periodEnd, tz) : null;

  return (
    <>
      <h1>
        Billing{" "}
        {testMode && (
          <span className="crm-pill crm-pill-late" title="No real money moves">
            Test mode
          </span>
        )}
      </h1>

      {o.status === "past_due" && (
        <p role="alert" className="crm-warn">
          <strong>Your last payment did not go through.</strong> Update your card below and we will
          try again straight away. If it keeps failing your account will be paused.
        </p>
      )}
      {o.status === "canceled" && (
        <p role="alert" className="crm-warn">
          This subscription has ended. Contact us to start again.
        </p>
      )}

      <section className="billing-card" aria-labelledby="bill-plan">
        <h2 id="bill-plan">Your plan</h2>
        <dl className="billing-facts">
          <div>
            <dt>Plan</dt>
            <dd>{plan.name}</dd>
          </div>
          <div>
            <dt>People</dt>
            <dd>
              {activeUsers} signed up, room for {o.seats}
            </dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              {formatMoney(o.monthlyCents)} a month
              {o.extraUsers > 0
                ? ` (includes ${o.extraUsers} extra ${o.extraUsers === 1 ? "person" : "people"})`
                : ""}
            </dd>
          </div>
          <div>
            <dt>{o.cancelAtPeriodEnd ? "Ends on" : "Next payment"}</dt>
            <dd>{renews ?? "Not scheduled"}</dd>
          </div>
        </dl>
      </section>

      <section className="billing-card" aria-labelledby="bill-change">
        <h2 id="bill-change">Change plan or people</h2>
        <p className="crm-muted">
          {USERS_INCLUDED} people are included in every plan. You pay the difference for the rest of
          this month now, and the new price from your next bill.
        </p>
        <ChangePlan
          current={{ edition: o.edition, extraUsers: o.extraUsers }}
          activeUsers={activeUsers}
        />
      </section>

      <section className="billing-card" aria-labelledby="bill-card">
        <h2 id="bill-card">Payment method</h2>
        <CardUpdate
          card={o.card}
          pastDue={o.status === "past_due"}
          publishableKey={canUpdateCard ? (process.env.STRIPE_PUBLISHABLE_KEY ?? null) : null}
        />
      </section>

      <section className="billing-card" aria-labelledby="bill-invoices">
        <h2 id="bill-invoices">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="crm-muted">No invoices yet.</p>
        ) : (
          <div className="billing-table-wrap">
            <table className="billing-table">
              <caption className="sr-only">Your invoices</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Number</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{formatDate(i.date, tz)}</td>
                    <td>{i.number ?? "—"}</td>
                    <td>{formatMoney(i.totalCents)}</td>
                    <td>{STATUS_WORDS[i.status] ?? i.status}</td>
                    <td>
                      {i.pdfUrl ? (
                        <a href={i.pdfUrl} download>
                          PDF<span className="sr-only"> for invoice {i.number ?? i.id}</span>
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="billing-card" aria-labelledby="bill-cancel">
        <h2 id="bill-cancel">Cancel</h2>
        <CancelControls cancelAtPeriodEnd={o.cancelAtPeriodEnd} endsOn={renews} />
      </section>
    </>
  );
}
