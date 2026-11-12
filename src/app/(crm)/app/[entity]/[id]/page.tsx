import Link from "next/link";
import { notFound } from "next/navigation";
import { BusinessProcessFlow } from "@/components/form/BusinessProcessFlow";
import { EntityForm } from "@/components/form/EntityForm";
import { NoteForm, RecordCommands } from "@/components/form/RecordCommands";
import { Timeline } from "@/components/form/Timeline";
import { entityBySlug, recordTitle } from "@/entities";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { timeline } from "@/server/domain/activities";
import { buildCtx } from "@/server/domain/context";
import { OpportunityLines } from "@/components/form/OpportunityLines";
import { listProducts } from "@/server/domain/catalog";
import { listOpportunityLines } from "@/server/domain/opportunity-lines";
import { OPS, withDynamicOptions } from "@/server/entities/registry";
import { tenantTimeZone } from "@/server/entities/tenant";

export default async function RecordPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  const meta = entityBySlug(entity);
  if (!meta) notFound();
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const res = await OPS[meta.key].get(ctx, id);
  if (!res.ok) notFound();
  const row = res.row;

  // Display names for lookup fields (reads go through the same permission checks).
  const lookupLabels: Record<string, string> = {};
  for (const f of meta.fields.filter((x) => x.type === "lookup")) {
    const rid = row[f.name];
    if (typeof rid !== "string") continue;
    const r = await OPS[f.lookup!].get(ctx, rid);
    if (r.ok) lookupLabels[f.name] = recordTitle(entityBySlug(f.lookup! + "s")!, r.row);
  }

  const hasTimeline = meta.key !== "product";
  const oppLinesRes = meta.key === "opportunity" ? await listOpportunityLines(ctx, id) : null;
  const oppLines = oppLinesRes?.ok ? oppLinesRes.lines : null;
  const productsRes = meta.key === "opportunity" ? await listProducts(ctx, { limit: 200 }) : null;
  const catalog = productsRes?.ok
    ? productsRes.rows.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` }))
    : [];
  const [tl, tz] = await Promise.all([
    hasTimeline ? timeline(ctx, meta.key as "lead", id) : Promise.resolve(null),
    tenantTimeZone(user.tenantId),
  ]);
  const status = typeof row.status === "string" ? row.status : "";
  const fieldByName = Object.fromEntries(meta.fields.map((f) => [f.name, f]));
  const show = (name: string) => {
    const v = row[name];
    const f = fieldByName[name];
    if (v === null || v === undefined || v === "") return "—";
    if (f?.type === "money") return formatMoney(v);
    if (f?.type === "date") return formatDate(v, tz);
    return typeof v === "string" ? humanize(v) : String(v);
  };

  return (
    <>
      <h1>{recordTitle(meta, row)}</h1>
      <p>
        {meta.singular} · {String(row[meta.numberField] ?? "")}
        {status && ` · ${humanize(status)}`}
      </p>
      <dl className="crm-header">
        {meta.headerFields.map((n) => (
          <div key={n}>
            <dt>{fieldByName[n]?.label ?? humanize(n)}</dt>
            <dd>{show(n)}</dd>
          </div>
        ))}
      </dl>
      {meta.key === "opportunity" && (
        <BusinessProcessFlow stage={String(row.stage)} status={status} />
      )}
      {meta.key === "opportunity" && (
        <p>
          <Link className="crm-btn" href={`/app/quotes/new?opportunityId=${id}`}>
            + New quote
          </Link>
        </p>
      )}
      <RecordCommands
        entityKey={meta.key}
        id={id}
        status={status}
        stage={typeof row.stage === "string" ? row.stage : undefined}
      />
      {meta.key === "opportunity" && oppLines && (
        <OpportunityLines
          opportunityId={id}
          editable={status === "open"}
          lines={oppLines.map((l) => ({
            id: l.id,
            lineNumber: l.lineNumber,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unitPriceCents: l.unitPriceCents,
            discountCents: l.discountCents,
            extendedCents: l.extendedCents,
          }))}
          products={catalog}
        />
      )}
      <EntityForm
        meta={await withDynamicOptions(ctx, meta)}
        id={id}
        record={row}
        lookupLabels={lookupLabels}
      />
      {hasTimeline && (
        <>
          <h2>Timeline</h2>
          <NoteForm entityKey={meta.key} id={id} />
          {tl?.ok && <Timeline items={tl.items} tz={tz} />}
        </>
      )}
    </>
  );
}
