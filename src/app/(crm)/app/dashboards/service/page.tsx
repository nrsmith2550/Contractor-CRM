import type { Metadata } from "next";
import Link from "next/link";
import { BarCard } from "@/components/dashboard/BarCard";
import { formatDateTime, humanize } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { serviceDashboard } from "@/server/domain/dashboards";
import { tenantTimeZone } from "@/server/entities/tenant";

export const metadata: Metadata = { title: "Service dashboard" };

export default async function ServiceDashboardPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const tz = await tenantTimeZone(user.tenantId);
  const r = await serviceDashboard(ctx, { now: new Date(), tz });
  if (!r.ok) return <p role="alert">{r.message}</p>;
  const none = <p className="crm-muted">You don&apos;t have access to this.</p>;

  return (
    <>
      <h1>Service dashboard</h1>
      <div className="dash-grid">
        {r.casesByPriority ? (
          <BarCard
            title="Active support requests by priority"
            data={r.casesByPriority}
            empty="No active support requests."
          />
        ) : (
          none
        )}
        {r.breaches ? (
          <section className="crm-card dash-card" aria-label="SLA breaches">
            <h2>SLA breaches ({r.breachCount})</h2>
            {r.breaches.length === 0 ? (
              <p className="crm-muted">No support request is past its due time.</p>
            ) : (
              <ul className="dash-list">
                {r.breaches.map((b) => (
                  <li key={b.id}>
                    <Link href={`/app/support-requests/${b.id}`}>
                      {b.ticketNumber} {b.title}
                    </Link>
                    <span className="crm-muted">
                      {" "}
                      · {humanize(b.priority)} · due {formatDateTime(b.dueAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          none
        )}
        {r.bookingsToday ? (
          <BarCard
            title="Today's visits by team member"
            data={r.bookingsToday}
            empty="Nothing booked today."
            color="#107c10"
          />
        ) : (
          none
        )}
      </div>
    </>
  );
}
