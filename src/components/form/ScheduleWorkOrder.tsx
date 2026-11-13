"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { humanize } from "@/lib/format";
import type { CmdResult } from "@/server/actions/entities";
import {
  bookingStatusAction,
  createBookingAction,
  workOrderSkillsAction,
} from "@/server/actions/bookings";

export type WoBooking = {
  id: string;
  status: string;
  resourceName: string;
  when: string;
  signedByName: string | null;
  hasSignature: boolean;
};

/** Dispatcher panel on a work order: required skills, existing bookings, and a booking form. */
export function ScheduleWorkOrder(props: {
  workOrderId: string;
  editable: boolean; // can still be booked / have its skills changed
  resources: { id: string; name: string }[];
  skills: { id: string; name: string }[];
  requiredSkillIds: string[];
  bookings: WoBooking[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<CmdResult | null>(null);
  const [skillIds, setSkillIds] = useState(props.requiredSkillIds);
  const [v, setV] = useState({
    resourceId: props.resources[0]?.id ?? "",
    start: "",
    end: "",
    notes: "",
  });
  const live = props.bookings.some((b) =>
    ["scheduled", "travelling", "in_progress"].includes(b.status),
  );

  const run = (fn: () => Promise<CmdResult>) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      if (r.ok) router.refresh();
    });

  return (
    <section aria-label="Scheduling">
      <h2>Scheduling</h2>

      {props.skills.length > 0 && (
        <fieldset className="crm-section" disabled={!props.editable}>
          <legend>Required skills</legend>
          <div className="crm-row" style={{ flexWrap: "wrap" }}>
            {props.skills.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={skillIds.includes(s.id)}
                  onChange={(e) =>
                    setSkillIds(
                      e.target.checked ? [...skillIds, s.id] : skillIds.filter((x) => x !== s.id),
                    )
                  }
                />{" "}
                {s.name}
              </label>
            ))}
          </div>
          <button
            className="crm-btn"
            type="button"
            disabled={pending}
            onClick={() => run(() => workOrderSkillsAction(props.workOrderId, skillIds))}
          >
            Save required skills
          </button>
        </fieldset>
      )}

      <table className="crm-grid">
        <caption className="crm-sr">Bookings</caption>
        <thead>
          <tr>
            <th scope="col">Resource</th>
            <th scope="col">When</th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="crm-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.bookings.length === 0 && (
            <tr>
              <td colSpan={4}>Not booked yet.</td>
            </tr>
          )}
          {props.bookings.map((b) => (
            <tr key={b.id}>
              <td>{b.resourceName}</td>
              <td>{b.when}</td>
              <td>
                <span className="crm-badge">{humanize(b.status)}</span>
                {b.hasSignature && <div className="crm-muted">Signed by {b.signedByName}</div>}
              </td>
              <td>
                {(b.status === "scheduled" || b.status === "travelling") && (
                  <button
                    className="crm-btn"
                    disabled={pending}
                    aria-label={`Cancel booking for ${b.resourceName}`}
                    onClick={() => run(() => bookingStatusAction(b.id, "cancelled"))}
                  >
                    Cancel booking
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {props.editable && !live && (
        <form
          className="crm-panel"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createBookingAction(props.workOrderId, v));
          }}
        >
          <label>
            Resource
            <select
              value={v.resourceId}
              onChange={(e) => setV({ ...v, resourceId: e.target.value })}
            >
              {props.resources.length === 0 && <option value="">No resources yet</option>}
              {props.resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start
            <input
              type="datetime-local"
              value={v.start}
              onChange={(e) => setV({ ...v, start: e.target.value })}
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={v.end}
              onChange={(e) => setV({ ...v, end: e.target.value })}
            />
          </label>
          <label>
            Notes
            <input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
          </label>
          <button
            className="crm-btn crm-btn-primary"
            type="submit"
            disabled={pending || !v.resourceId}
          >
            Book
          </button>
        </form>
      )}

      {res && !res.ok && (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      )}
      {res?.ok && res.message && (
        <div role="status" className="crm-ok">
          {res.message}
        </div>
      )}
      {res?.ok && res.warnings && res.warnings.length > 0 && (
        <div role="group" aria-label="Booking warnings" className="crm-warn">
          <strong>Booked, but check:</strong>
          <ul>
            {res.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
