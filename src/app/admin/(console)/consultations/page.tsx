import type { Metadata } from "next";
import {
  REQUEST_STATUSES,
  bestTimeLabel,
  teamSizeLabel,
  timeZoneLabel,
  tradeLabel,
} from "@/lib/consultation";
import { consultationUpdateAction } from "@/server/actions/admin";
import { listConsultationRequests } from "@/server/domain/consultations";
import { AdminActionForm } from "../../admin-forms";

export const metadata: Metadata = { title: "Consultations" };
export const dynamic = "force-dynamic";

const statusOptions = REQUEST_STATUSES.map((s) => ({ value: s, label: s }));

export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const rows = await listConsultationRequests({ status });
  return (
    <main>
      <h1>Consultation requests</h1>
      <p>People who asked for a call. Phone them, agree a time, then track it here.</p>
      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>

      {rows.map((r) => (
        <section
          key={r.id}
          aria-label={`Request from ${r.name}`}
          style={{ border: "1px solid #c8c6c4", borderRadius: 4, padding: 12, marginBottom: 12 }}
        >
          <h2 style={{ marginTop: 0 }}>
            {r.name} · {r.business} <small>({r.status})</small>
          </h2>
          <p>
            <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> ·{" "}
            <a href={`mailto:${r.email}`}>{r.email}</a>
          </p>
          <p>
            {tradeLabel(r.trade)} · {teamSizeLabel(r.teamSize)} · call {bestTimeLabel(r.bestTime)} (
            {timeZoneLabel(r.timeZone)}) · received{" "}
            {r.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
          {r.message ? <p style={{ whiteSpace: "pre-wrap" }}>{r.message}</p> : null}
          <details>
            <summary>Update status and notes</summary>
            <AdminActionForm
              action={consultationUpdateAction}
              fixed={{ id: r.id }}
              submitLabel="Save"
              fields={[
                {
                  name: "status",
                  label: "Status",
                  type: "select",
                  options: statusOptions,
                  defaultValue: r.status,
                },
                { name: "notes", label: "Notes", type: "textarea", defaultValue: r.notes ?? "" },
              ]}
            />
          </details>
        </section>
      ))}
      {rows.length === 0 ? <p>No requests yet.</p> : null}
    </main>
  );
}
