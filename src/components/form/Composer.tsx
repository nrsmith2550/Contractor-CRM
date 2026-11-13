"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EntityKey } from "@/entities/types";
import { logActivityAction } from "@/server/actions/activities";
import { NoteForm } from "./RecordCommands";

type Mode = "note" | "phone_call" | "task";

const MODES: [Mode, string][] = [
  ["note", "Note"],
  ["phone_call", "Call"],
  ["task", "Task"],
];

/** One place to add to a record's timeline: write a note, log a phone call, or add a task. */
export function Composer({ entityKey, id }: { entityKey: EntityKey; id: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("note");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [direction, setDirection] = useState("outgoing");
  const [priority, setPriority] = useState("normal");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await logActivityAction(entityKey, id, {
        type: mode as "task" | "phone_call",
        subject,
        description,
        due,
        direction,
        priority,
      });
      if (r.ok) {
        setSubject("");
        setDescription("");
        setDue("");
        setErr("");
        router.refresh();
      } else setErr(r.message);
    });
  };

  return (
    <div className="crm-composer">
      <div role="group" aria-label="What to add" className="crm-seg">
        {MODES.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
              setErr("");
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "note" ? (
        <NoteForm entityKey={entityKey} id={id} />
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="act-subject">
            {mode === "task" ? "What needs doing?" : "What was the call about?"}
          </label>
          <input
            id="act-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
          />
          {mode === "task" ? (
            <div className="crm-row" style={{ flexWrap: "wrap" }}>
              <label htmlFor="act-due">
                Due date
                <input
                  id="act-due"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <label htmlFor="act-priority">
                Priority
                <select
                  id="act-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
          ) : (
            <label htmlFor="act-direction">
              Direction
              <select
                id="act-direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="outgoing">I called them</option>
                <option value="incoming">They called me</option>
              </select>
            </label>
          )}
          <label htmlFor="act-notes">Notes (optional)</label>
          <textarea
            id="act-notes"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {err && (
            <div role="alert" className="crm-error">
              {err}
            </div>
          )}
          <button
            className="crm-btn crm-btn-primary"
            type="submit"
            disabled={pending || subject.trim() === ""}
          >
            {mode === "task" ? "Add task" : "Log call"}
          </button>
        </form>
      )}
    </div>
  );
}
