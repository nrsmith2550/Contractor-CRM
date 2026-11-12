"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { nextStatuses, type WoStatus } from "@/server/domain/work-order-status";
import type { CmdResult } from "@/server/actions/entities";
import {
  caseCommandAction,
  workOrderStatusAction,
  type CaseCommand,
} from "@/server/actions/service";

const ACTIVE = ["in_progress", "on_hold", "waiting_on_customer"];

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [res, setRes] = useState<CmdResult | null>(null);
  const run = (fn: () => Promise<CmdResult>) =>
    start(async () => {
      const r = await fn();
      setRes(r);
      if (r.ok) {
        if (r.redirectTo) router.push(r.redirectTo);
        else router.refresh();
      }
    });
  return { pending, res, run };
}

function Result({ res }: { res: CmdResult | null }) {
  if (!res) return null;
  return res.ok ? (
    res.message ? (
      <div role="status" className="crm-ok">
        {res.message}
      </div>
    ) : null
  ) : (
    <div role="alert" className="crm-error">
      {res.message}
    </div>
  );
}

/** Case commands: hold / wait / resume, Resolve (with the resolution), Cancel, Reactivate, Convert. */
export function CaseCommands({ id, status }: { id: string; status: string }) {
  const { pending, res, run } = useRunner();
  const [panel, setPanel] = useState<"" | "resolve">("");
  const [resolution, setResolution] = useState("");
  const [minutes, setMinutes] = useState("");
  const active = ACTIVE.includes(status);
  const btn = (label: string, cmd: CaseCommand, primary = false) => (
    <button
      type="button"
      className={`crm-btn${primary ? " crm-btn-primary" : ""}`}
      disabled={pending}
      onClick={() => run(() => caseCommandAction(cmd, id))}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div className="crm-commandbar" role="toolbar" aria-label="Case commands">
        {active && (
          <>
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              disabled={pending}
              onClick={() => setPanel(panel ? "" : "resolve")}
            >
              Resolve case
            </button>
            {btn("Convert to work order", "convert")}
            {status !== "in_progress" && btn("Resume", "resume")}
            {status !== "on_hold" && btn("Put on hold", "hold")}
            {status !== "waiting_on_customer" && btn("Waiting on customer", "waiting")}
            {btn("Cancel case", "cancel")}
          </>
        )}
        {!active && btn("Reactivate", "reactivate", true)}
      </div>
      {panel === "resolve" && (
        <div className="crm-panel" role="group" aria-label="Resolve case">
          <label>
            Resolution
            <textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </label>
          <label>
            Billable minutes
            <input
              inputMode="numeric"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="crm-btn crm-btn-primary"
            disabled={pending}
            onClick={() =>
              run(() => caseCommandAction("resolve", id, { resolution, billableMinutes: minutes }))
            }
          >
            Confirm resolve
          </button>
        </div>
      )}
      <Result res={res} />
    </div>
  );
}

const WO_LABEL: Record<WoStatus, string> = {
  unscheduled: "Unschedule",
  scheduled: "Mark scheduled",
  in_progress: "Start work",
  completed: "Complete",
  posted: "Post",
  cancelled: "Cancel work order",
};

/** Work order status buttons: only the moves the status flow allows from here. */
export function WorkOrderCommands({ id, status }: { id: string; status: WoStatus }) {
  const { pending, res, run } = useRunner();
  const moves = nextStatuses(status);
  return (
    <div>
      <div className="crm-commandbar" role="toolbar" aria-label="Work order commands">
        {moves.map((to, i) => (
          <button
            key={to}
            type="button"
            className={`crm-btn${i === 0 && to !== "cancelled" ? " crm-btn-primary" : ""}`}
            disabled={pending}
            onClick={() => run(() => workOrderStatusAction(id, to))}
          >
            {status === "cancelled" && to === "unscheduled"
              ? "Reinstate"
              : status === "completed" && to === "in_progress"
                ? "Reopen"
                : WO_LABEL[to]}
          </button>
        ))}
        {moves.length === 0 && <span>Posted work orders are final.</span>}
      </div>
      <Result res={res} />
    </div>
  );
}
