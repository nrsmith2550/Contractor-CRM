import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/shell/Icon";
import { formatDateTime, formatMoney, humanize } from "@/lib/format";
import { WORDS } from "@/lib/vocabulary";
import { tenantName, tenantTimeZone } from "@/server/entities/tenant";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { salesDashboard, serviceDashboard } from "@/server/domain/dashboards";
import { openPipelineValue } from "@/server/domain/opportunities";
import { OPS } from "@/server/entities/registry";

export const metadata: Metadata = { title: "Home" };

const ONE = { limit: 1, offset: 0 } as const;

export default async function HomePage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const tz = await tenantTimeZone(user.tenantId);
  const now = new Date();
  const [leads, opps, value, requests, jobs, customers, products, anyLeads, sales, service] =
    await Promise.all([
      // Lists only ever include what this person is allowed to see, so "open" means their share.
      OPS.lead.list(ctx, { view: "all_open", ...ONE }),
      OPS.opportunity.list(ctx, { view: "open", ...ONE }),
      openPipelineValue(ctx),
      OPS.case.list(ctx, { view: "all_active", ...ONE }),
      OPS.work_order.list(ctx, { view: "all_open", ...ONE }),
      OPS.account.list(ctx, { view: "all", ...ONE }),
      OPS.product.list(ctx, { view: "all", ...ONE }),
      OPS.lead.list(ctx, { view: "all_open", ...ONE }),
      salesDashboard(ctx, { now, tz }),
      serviceDashboard(ctx, { now, tz }),
    ]);
  const tasks = sales.ok ? sales.myActivities : null;
  const late = service.ok ? service.breaches : null;
  const count = (r: { ok: boolean; total?: number }) => (r.ok ? String(r.total ?? 0) : "—");
  const has = (r: { ok: boolean; total?: number }) => r.ok && (r.total ?? 0) > 0;

  const tile = (icon: IconName, label: string, v: string, href: string) => (
    <Link href={href} className="crm-tile" key={href}>
      <span className="crm-tile-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="crm-tile-value">{v}</span>
      <span className="crm-tile-label">{label}</span>
    </Link>
  );

  const steps: { done: boolean; label: string; href: string }[] = [
    {
      done: has(customers),
      label: `Add your first ${WORDS.account.one.toLowerCase()}`,
      href: "/app/customers/new",
    },
    {
      done: has(products),
      label: "Add a product or service you sell",
      href: "/app/products/new",
    },
    {
      done: has(anyLeads),
      label: `Add a ${WORDS.lead.one.toLowerCase()} you are talking to`,
      href: "/app/prospects/new",
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  const first = user.fullName.split(/\s+/)[0] || user.fullName;

  return (
    <>
      <div className="home-head">
        <div>
          <h1>Home</h1>
          <p className="home-sub">
            Welcome back, {first}. You&apos;re signed in to{" "}
            <strong>{await tenantName(user.tenantId)}</strong>.
          </p>
        </div>
        <div className="home-actions" role="group" aria-label="Quick actions">
          <Link href="/app/prospects/new" className="crm-btn crm-btn-primary">
            <Icon name="plus" size={16} /> New {WORDS.lead.one.toLowerCase()}
          </Link>
          <Link href="/app/support-requests/new" className="crm-btn">
            <Icon name="plus" size={16} /> New request
          </Link>
          <Link href="/app/jobs/new" className="crm-btn">
            <Icon name="plus" size={16} /> New {WORDS.workOrder.one.toLowerCase()}
          </Link>
        </div>
      </div>

      <div className="home-tiles">
        {tile(
          "target",
          `Open ${WORDS.lead.many.toLowerCase()}`,
          count(leads),
          "/app/prospects?view=all_open",
        )}
        {tile(
          "deal",
          `Open ${WORDS.opportunity.many.toLowerCase()}`,
          count(opps),
          "/app/deals?view=open",
        )}
        {tile("funnel", "Open pipeline value", formatMoney(value), "/app/pipeline")}
        {tile("support", "Active support requests", count(requests), "/app/support-requests")}
        {tile("job", `Open ${WORDS.workOrder.many.toLowerCase()}`, count(jobs), "/app/jobs")}
      </div>

      {(tasks || late) && (
        <div className="home-panels">
          {tasks && (
            <section className="home-panel" aria-labelledby="home-tasks">
              <h2 id="home-tasks">Your open tasks</h2>
              {tasks.length === 0 ? (
                <p className="crm-muted">Nothing open. Nice.</p>
              ) : (
                <ul>
                  {tasks.map((a) => (
                    <li key={a.id}>
                      {a.href ? <Link href={a.href}>{a.subject}</Link> : a.subject}
                      <span className="crm-muted">
                        {" "}
                        · {humanize(a.type)}
                        {a.when ? ` · ${formatDateTime(a.when, tz)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {late && (
            <section className="home-panel" aria-labelledby="home-late">
              <h2 id="home-late">Past due</h2>
              {late.length === 0 ? (
                <p className="crm-muted">No support request is past its due time.</p>
              ) : (
                <ul>
                  {late.map((b) => (
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
          )}
        </div>
      )}

      {remaining > 0 && (
        <section className="home-steps" aria-labelledby="first-steps">
          <h2 id="first-steps">Getting started</h2>
          <p className="home-sub">
            {remaining === 1 ? "One last step" : `${remaining} quick steps`} to get set up. You can
            do them in any order.
          </p>
          <ul>
            {steps.map((s) => (
              <li key={s.href} className={s.done ? "is-done" : undefined}>
                <span className="home-check" aria-hidden="true">
                  {s.done && <Icon name="check" size={14} />}
                </span>
                {s.done ? (
                  <span>
                    {s.label} <span className="sr-only">(done)</span>
                  </span>
                ) : (
                  <Link href={s.href}>{s.label}</Link>
                )}
              </li>
            ))}
          </ul>
          <p>
            Stuck? Read the <Link href="/app/help/first-day">first-day guide</Link>.
          </p>
        </section>
      )}
    </>
  );
}
