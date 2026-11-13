import type { Metadata } from "next";
import Link from "next/link";
import { BarCard } from "@/components/dashboard/BarCard";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { salesDashboard } from "@/server/domain/dashboards";
import { tenantTimeZone } from "@/server/entities/tenant";

export const metadata: Metadata = { title: "Sales dashboard" };

export default async function SalesDashboardPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const tz = await tenantTimeZone(user.tenantId);
  const r = await salesDashboard(ctx, { now: new Date(), tz });
  if (!r.ok) return <p role="alert">{r.message}</p>;
  const none = <p className="crm-muted">You don&apos;t have access to this.</p>;

  return (
    <>
      <h1>Sales dashboard</h1>
      <div className="dash-grid">
        {r.pipeline ? (
          <BarCard title="Open pipeline by stage" data={r.pipeline} money empty="No open deals." />
        ) : (
          none
        )}
        {r.wonCents !== null ? (
          <section className="crm-card dash-card" aria-label={`Won revenue ${r.quarter}`}>
            <h2>Won revenue, {r.quarter}</h2>
            <div style={{ fontSize: 32, fontWeight: 600 }}>{formatMoney(r.wonCents)}</div>
            <div className="crm-muted">
              {r.wonCount} {r.wonCount === 1 ? "deal" : "deals"} won
            </div>
          </section>
        ) : null}
        {r.leadsBySource ? (
          <BarCard
            title="Open prospects by source"
            data={r.leadsBySource}
            empty="No open prospects."
            color="#bc4b09"
          />
        ) : (
          none
        )}
        {r.myActivities ? (
          <section className="crm-card dash-card" aria-label="My activities">
            <h2>My activities</h2>
            {r.myActivities.length === 0 ? (
              <p className="crm-muted">Nothing open. Nice.</p>
            ) : (
              <ul className="dash-list">
                {r.myActivities.map((a) => (
                  <li key={a.id}>
                    {a.href ? <Link href={a.href}>{a.subject}</Link> : a.subject}
                    <span className="crm-muted">
                      {" "}
                      · {a.type}
                      {a.when ? ` · ${formatDateTime(a.when, tz)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          none
        )}
      </div>
    </>
  );
}
