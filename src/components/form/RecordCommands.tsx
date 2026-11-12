"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EntityKey } from "@/entities/types";
import { addNoteAction, recordCommandAction, type CmdResult } from "@/server/actions/entities";

type Dup = { kind: string; id: string; label: string; matchedOn?: string[] };

/** Command bar for a saved record: lead and opportunity workflow actions, with their prompts. */
export function RecordCommands(props: {
  entityKey: EntityKey;
  id: string;
  status: string;
  stage?: string;
}) {
  const { entityKey, id, status, stage } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CmdResult | null>(null);
  const [panel, setPanel] = useState<"" | "disqualify" | "won" | "lost">("");
  const [v, setV] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const run = (command: string, extra: Record<string, string> = {}) =>
    start(async () => {
      const r = await recordCommandAction(command, entityKey, id, { ...v, ...extra });
      setResult(r);
      if (r.ok) {
        setPanel("");
        if (r.redirectTo) router.push(r.redirectTo);
        else router.refresh();
      }
    });

  const dups =
    result && !result.ok && result.code === "duplicates" ? (result.duplicates as Dup[]) : [];
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button
      type="button"
      className={`crm-btn${primary ? " crm-btn-primary" : ""}`}
      disabled={pending}
      onClick={onClick}
    >
      {label}
    </button>
  );

  const NEXT: Record<string, string> = { qualify: "develop", develop: "propose", propose: "close" };

  return (
    <div>
      <div className="crm-commandbar" role="toolbar" aria-label="Record commands">
        {entityKey === "lead" && (status === "new" || status === "contacted") && (
          <>
            {btn("Qualify", () => run("qualify"), true)}
            {status === "new" && btn("Mark contacted", () => run("contacted"))}
            {btn("Disqualify", () => setPanel("disqualify"))}
          </>
        )}
        {entityKey === "lead" &&
          status !== "open" &&
          status !== "qualified" &&
          btn("Reactivate", () => run("reactivate"))}
        {entityKey === "opportunity" && status === "open" && (
          <>
            {stage &&
              NEXT[stage] &&
              btn(`Move to ${NEXT[stage]}`, () => run("stage", { stage: NEXT[stage]! }), true)}
            {btn("Close as won", () => setPanel("won"))}
            {btn("Close as lost", () => setPanel("lost"))}
          </>
        )}
        {entityKey === "opportunity" && status !== "open" && btn("Reopen", () => run("reopen"))}
      </div>

      {panel === "disqualify" && (
        <div className="crm-panel" role="group" aria-label="Disqualify lead">
          <label>
            Reason
            <input value={v.reason ?? ""} onChange={set("reason")} />
          </label>
          {btn("Confirm disqualify", () => run("disqualify"), true)}
          {btn("Cancel", () => setPanel(""))}
        </div>
      )}
      {panel === "won" && (
        <div className="crm-panel" role="group" aria-label="Close as won">
          <label>
            Actual revenue
            <input
              inputMode="decimal"
              value={v.actualRevenue ?? ""}
              onChange={set("actualRevenue")}
            />
          </label>
          <label>
            Close date
            <input type="date" value={v.actualCloseDate ?? ""} onChange={set("actualCloseDate")} />
          </label>
          <label>
            Competitor
            <input value={v.competitor ?? ""} onChange={set("competitor")} />
          </label>
          {btn("Confirm won", () => run("won"), true)}
          {btn("Cancel", () => setPanel(""))}
        </div>
      )}
      {panel === "lost" && (
        <div className="crm-panel" role="group" aria-label="Close as lost">
          <label>
            Reason
            <input value={v.reason ?? ""} onChange={set("reason")} />
          </label>
          <label>
            Competitor
            <input value={v.competitor ?? ""} onChange={set("competitor")} />
          </label>
          {btn("Confirm lost", () => run("lost"), true)}
          {btn("Cancel", () => setPanel(""))}
        </div>
      )}

      {result && !result.ok && (
        <div role="alert" className="crm-error">
          {result.message}
          {result.missing && result.missing.length > 0 && (
            <ul>
              {result.missing.map((m) => (
                <li key={m.field}>{m.label} is required to continue</li>
              ))}
            </ul>
          )}
          {dups.length > 0 && (
            <div>
              <p>Possible duplicates found. Use an existing record or create a new one:</p>
              <ul>
                {dups.map((d) => (
                  <li key={d.id}>
                    {d.kind}: {d.label}{" "}
                    {btn(`Use this ${d.kind}`, () => run("qualify", { [d.kind]: d.id }))}
                  </li>
                ))}
              </ul>
              {btn("Create new records anyway", () =>
                run("qualify", { account: "new", contact: "new" }),
              )}
            </div>
          )}
        </div>
      )}
      {result?.ok && result.message && (
        <div role="status" className="crm-ok">
          {result.message}
        </div>
      )}
    </div>
  );
}

export function NoteForm({ entityKey, id }: { entityKey: EntityKey; id: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addNoteAction(entityKey, id, body);
          if (r.ok) {
            setBody("");
            setErr("");
            router.refresh();
          } else setErr(r.message);
        });
      }}
    >
      <label htmlFor="note-body">Add a note</label>
      <textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
      {err && (
        <div role="alert" className="crm-error">
          {err}
        </div>
      )}
      <button className="crm-btn" type="submit" disabled={pending || body.trim() === ""}>
        Add note
      </button>
    </form>
  );
}
