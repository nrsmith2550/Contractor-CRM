"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { humanize } from "@/lib/vocabulary";
import {
  addJobPhaseAction,
  removeJobPhaseAction,
  setJobPhaseStatusAction,
} from "@/server/actions/job-phases";
import type { CmdResult } from "@/server/actions/entities";
import { nextPhaseStatuses, type PhaseStatus } from "@/server/domain/job-phase-status";
import { InlineForm } from "./InlineForm";

export type PhaseView = {
  id: string;
  phaseNumber: number;
  title: string;
  instructions: string | null;
  status: PhaseStatus;
  estDurationMin: number | null;
};

const ACTION_LABEL: Record<PhaseStatus, string> = {
  unscheduled: "Reinstate",
  scheduled: "Mark scheduled",
  in_progress: "Start",
  completed: "Complete",
  cancelled: "Cancel",
};

/** The button text for moving a phase from one status to another. */
const labelFor = (from: PhaseStatus, to: PhaseStatus): string =>
  from === "completed" && to === "in_progress"
    ? "Reopen"
    : from === "in_progress" && to === "scheduled"
      ? "Back to scheduled"
      : from === "scheduled" && to === "unscheduled"
        ? "Unschedule"
        : ACTION_LABEL[to];

/**
 * The phases of a job: each is a small job of its own (a title, instructions, a status and a time
 * estimate), so different people can do different pieces of the same job.
 */
export function JobPhases(props: {
  workOrderId: string;
  canEdit: boolean; // dispatchers, while the job's own work is still open
  phases: PhaseView[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<CmdResult | null>(null);
  const counted = props.phases.filter((p) => p.status !== "cancelled");
  const done = counted.filter((p) => p.status === "completed").length;

  const run = (fn: () => Promise<CmdResult>) =>
    start(async () => {
      const r = await fn();
      setErr(r.ok ? null : r);
      if (r.ok) router.refresh();
    });

  return (
    <section aria-label="Phases">
      <h2>Phases</h2>
      <p>
        {counted.length === 0
          ? "This job has no phases. Add one for each piece of work, such as one for each technician."
          : `${done} of ${counted.length} ${counted.length === 1 ? "phase" : "phases"} done`}
      </p>
      {props.phases.length > 0 && (
        <table className="crm-grid">
          <caption className="crm-sr">Phases of this job</caption>
          <thead>
            <tr>
              <th scope="col">Phase</th>
              <th scope="col">Work</th>
              <th scope="col">Status</th>
              <th scope="col">Estimate</th>
              {props.canEdit && (
                <th scope="col">
                  <span className="crm-sr">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {props.phases.map((p) => (
              <tr key={p.id} data-status={p.status}>
                <td>{p.phaseNumber}</td>
                <td>
                  <strong>{p.title}</strong>
                  {p.instructions && <div>{p.instructions}</div>}
                </td>
                <td>{humanize(p.status)}</td>
                <td>{p.estDurationMin ? `${p.estDurationMin} min` : ""}</td>
                {props.canEdit && (
                  <td>
                    {nextPhaseStatuses(p.status).map((to) => (
                      <button
                        key={to}
                        type="button"
                        className="crm-btn"
                        disabled={pending}
                        aria-label={`${labelFor(p.status, to)} phase ${p.phaseNumber}`}
                        onClick={() => run(() => setJobPhaseStatusAction(p.id, to))}
                      >
                        {labelFor(p.status, to)}
                      </button>
                    ))}
                    {(p.status === "unscheduled" || p.status === "cancelled") && (
                      <button
                        type="button"
                        className="crm-btn"
                        disabled={pending}
                        aria-label={`Remove phase ${p.phaseNumber}`}
                        onClick={() => run(() => removeJobPhaseAction(p.id))}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {props.canEdit && (
        <InlineForm
          submitLabel="Add phase"
          action={(v) => addJobPhaseAction(props.workOrderId, v)}
          fields={[
            { name: "title", label: "Phase title", placeholder: "e.g. Rough-in" },
            { name: "instructions", label: "Instructions", type: "textarea" },
            { name: "estDurationMin", label: "Estimate (minutes)", inputMode: "decimal" },
          ]}
        />
      )}
      {err && !err.ok && (
        <div role="alert" className="crm-error">
          {err.message}
        </div>
      )}
    </section>
  );
}
