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
import { SlaBadge } from "@/components/grid/SlaBadge";
import { CaseCommands, WorkOrderCommands } from "@/components/form/ServiceCommands";
import { listWorkOrders } from "@/server/domain/work-orders";
import { PartsAndLabour } from "@/components/form/PartsAndLabour";
import { listWorkOrderLines } from "@/server/domain/work-order-lines";
import { can } from "@/server/security/roles";
import { ScheduleWorkOrder, type WoBooking } from "@/components/form/ScheduleWorkOrder";
import { listWorkOrderBookings } from "@/server/domain/bookings";
import { listCharacteristics, listResources, listWorkOrderSkills } from "@/server/domain/resources";
import { utcToZonedInput } from "@/lib/tz";
import type { WoStatus } from "@/server/domain/work-order-status";
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
  const lines = meta.key === "work_order" ? await listWorkOrderLines(ctx, id) : null;
  const woProducts = meta.key === "work_order" ? await listProducts(ctx, { limit: 200 }) : null;
  const sched =
    meta.key === "work_order"
      ? await Promise.all([
          listResources(ctx),
          listCharacteristics(ctx),
          listWorkOrderSkills(ctx, id),
          listWorkOrderBookings(ctx, id),
          tenantTimeZone(user.tenantId),
        ])
      : null;
  const woRes =
    meta.key === "case" ? await listWorkOrders(ctx, { view: "all", incidentId: id }) : null;
  const caseWorkOrders = woRes?.ok ? woRes.rows : null;
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
      {meta.key === "case" && (
        <p>
          SLA:{" "}
          <SlaBadge
            status={status}
            createdAt={row.createdAt as Date}
            slaDueAt={(row.slaDueAt as Date | null) ?? null}
            resolvedAt={(row.resolvedAt as Date | null) ?? null}
          />
        </p>
      )}
      {meta.key === "case" && <CaseCommands id={id} status={status} />}
      {meta.key === "work_order" && <WorkOrderCommands id={id} status={status as WoStatus} />}
      {meta.key === "work_order" && typeof row.incidentId === "string" && (
        <p>
          Case: <Link href={`/app/cases/${row.incidentId}`}>open the case</Link>
        </p>
      )}
      {meta.key === "work_order" && sched && sched[0].ok && sched[3].ok && (
        <ScheduleWorkOrder
          workOrderId={id}
          editable={status === "unscheduled" || status === "scheduled"}
          resources={sched[0].rows.map((r) => ({ id: r.id, name: r.name }))}
          skills={sched[1].ok ? sched[1].rows.map((x) => ({ id: x.id, name: x.name })) : []}
          requiredSkillIds={sched[2].ok ? sched[2].skills.map((x) => x.id) : []}
          bookings={sched[3].rows.map((b): WoBooking => ({
            id: b.id,
            status: b.status,
            resourceName: b.resourceName,
            when: `${utcToZonedInput(b.startAt, sched[4]).replace("T", " ")} – ${utcToZonedInput(b.endAt, sched[4]).slice(11)}`,
            signedByName: b.signedByName,
            hasSignature: Boolean(b.signatureDataUrl),
          }))}
        />
      )}
      {meta.key === "work_order" && lines && lines.ok && (
        <PartsAndLabour
          workOrderId={id}
          editable={status !== "posted" && status !== "cancelled"}
          canLabour={can(ctx.subject, "work_order", "write")}
          parts={lines.parts}
          labour={lines.labour.map((l) => ({
            ...l,
            resourceName:
              (sched && sched[0].ok
                ? sched[0].rows.find((r) => r.id === l.resourceId)?.name
                : null) ?? null,
          }))}
          products={
            woProducts && woProducts.ok
              ? woProducts.rows.map((p) => ({ id: p.id, label: `${p.name} (${p.sku})` }))
              : []
          }
          resources={
            sched && sched[0].ok ? sched[0].rows.map((r) => ({ id: r.id, name: r.name })) : []
          }
        />
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
        tz={tz}
      />
      {meta.key === "case" && caseWorkOrders && (
        <section aria-label="Work orders">
          <h2>Work orders</h2>
          {caseWorkOrders.length === 0 ? (
            <p>No work orders yet. Use Convert to work order to send someone out.</p>
          ) : (
            <ul>
              {caseWorkOrders.map((w) => (
                <li key={w.id}>
                  <Link href={`/app/work-orders/${w.id}`}>{w.woNumber}</Link> · {w.title} ·{" "}
                  <span className="crm-badge">{humanize(w.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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
