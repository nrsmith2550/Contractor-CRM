import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RelatedRecords } from "@/components/records/RelatedRecords";
import { formatDateTime, humanize } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { getBooking } from "@/server/domain/bookings";
import { buildCtx } from "@/server/domain/context";
import { relatedRecords } from "@/server/domain/related";
import { tenantTimeZone } from "@/server/entities/tenant";
import { guardArea } from "@/server/auth/plan";

export const metadata: Metadata = { title: "Visit" };

/** One visit: who is going, when, where, and what happened. Everything it is linked to is a link. */
export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await guardArea("jobs");
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const res = await getBooking(ctx, id);
  if (!res.ok) notFound();
  const b = res.booking;
  const [tz, related] = await Promise.all([
    tenantTimeZone(user.tenantId),
    relatedRecords(ctx, "booking", id),
  ]);
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    ) : null;

  return (
    <>
      <h1>{b.woTitle ?? "Visit"}</h1>
      <p>
        Visit · {formatDateTime(b.startAt, tz)} – {formatDateTime(b.endAt, tz).split(", ").pop()} ·{" "}
        {humanize(b.status)}
      </p>
      <dl className="crm-header">
        {row("Team member", b.resourceName)}
        {row(
          "Job",
          b.workOrderId && (
            <Link href={`/app/jobs/${b.workOrderId}`}>
              {b.woNumber} {b.woTitle}
            </Link>
          ),
        )}
        {row("Address", b.woAddress.length > 0 && b.woAddress.join(", "))}
        {row("Set off", b.travellingAt && formatDateTime(b.travellingAt, tz))}
        {row("Started", b.startedAt && formatDateTime(b.startedAt, tz))}
        {row("Finished", b.completedAt && formatDateTime(b.completedAt, tz))}
        {row(
          "Signed off by",
          b.signedByName &&
            `${b.signedByName}${b.signedAt ? `, ${formatDateTime(b.signedAt, tz)}` : ""}`,
        )}
      </dl>
      {related.ok && <RelatedRecords groups={related.groups} />}
      {b.woInstructions && (
        <section aria-labelledby="visit-instructions">
          <h2 id="visit-instructions">Instructions</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{b.woInstructions}</p>
        </section>
      )}
      {b.notes && (
        <section aria-labelledby="visit-notes">
          <h2 id="visit-notes">Notes</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{b.notes}</p>
        </section>
      )}
    </>
  );
}
