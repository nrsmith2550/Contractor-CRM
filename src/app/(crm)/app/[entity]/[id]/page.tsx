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
import { OPS } from "@/server/entities/registry";
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

  const [tl, tz] = await Promise.all([timeline(ctx, meta.key, id), tenantTimeZone(user.tenantId)]);
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
      <RecordCommands
        entityKey={meta.key}
        id={id}
        status={status}
        stage={typeof row.stage === "string" ? row.stage : undefined}
      />
      <EntityForm meta={meta} id={id} record={row} lookupLabels={lookupLabels} />
      <h2>Timeline</h2>
      <NoteForm entityKey={meta.key} id={id} />
      {tl.ok && <Timeline items={tl.items} tz={tz} />}
    </>
  );
}
