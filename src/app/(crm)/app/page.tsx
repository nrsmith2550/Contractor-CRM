import type { Metadata } from "next";
import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { tenantName } from "@/server/entities/tenant";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { openPipelineValue } from "@/server/domain/opportunities";
import { OPS } from "@/server/entities/registry";

export const metadata: Metadata = { title: "Sales Hub" };

export default async function SalesHubPage() {
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const [leads, opps, value] = await Promise.all([
    OPS.lead.list(ctx, { view: "my_open", limit: 1, offset: 0 }),
    OPS.opportunity.list(ctx, { view: "my_open", limit: 1, offset: 0 }),
    openPipelineValue(ctx),
  ]);
  const tile = (label: string, v: string, href: string) => (
    <Link href={href} className="crm-card crm-tile">
      <div className="crm-tile-value">{v}</div>
      <div className="crm-tile-label">{label}</div>
    </Link>
  );
  return (
    <>
      <h1>Sales Hub</h1>
      <p>
        Welcome, {user.fullName}. You&apos;re signed in to{" "}
        <strong>{await tenantName(user.tenantId)}</strong>.
      </p>
      <div className="crm-row" style={{ flexWrap: "wrap" }}>
        {tile("My open prospects", leads.ok ? String(leads.total) : "—", "/app/prospects")}
        {tile("My open deals", opps.ok ? String(opps.total) : "—", "/app/deals")}
        {tile("Open pipeline value", formatMoney(value), "/app/pipeline")}
      </div>
    </>
  );
}
