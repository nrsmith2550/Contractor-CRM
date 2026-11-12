"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { EntityMeta, FieldDef } from "@/entities/types";
import { saveRecordAction, lookupAction, type CmdResult } from "@/server/actions/entities";

type Values = Record<string, string | boolean>;

/** Typeahead lookup: the user can only pick records they're allowed to read. */
function Lookup(props: {
  field: FieldDef;
  value: string;
  label: string;
  onPick: (id: string, label: string) => void;
}) {
  const { field, value, label, onPick } = props;
  const [q, setQ] = useState(label);
  const [opts, setOpts] = useState<{ id: string; label: string }[]>([]);
  const seq = useRef(0);
  useEffect(() => setQ(label), [label]);
  return (
    <div className="crm-lookup">
      <input
        id={`f-${field.name}`}
        role="combobox"
        aria-expanded={opts.length > 0}
        aria-controls={`l-${field.name}`}
        aria-autocomplete="list"
        value={q}
        placeholder="Search…"
        onChange={async (e) => {
          const text = e.target.value;
          setQ(text);
          if (value) onPick("", "");
          const n = ++seq.current;
          const r = text.trim().length >= 1 ? await lookupAction(field.lookup!, text) : [];
          if (n === seq.current) setOpts(r);
        }}
      />
      {opts.length > 0 && (
        <ul id={`l-${field.name}`} role="listbox" className="crm-listbox">
          {opts.map((o) => (
            <li
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              tabIndex={0}
              onClick={() => {
                onPick(o.id, o.label);
                setQ(o.label);
                setOpts([]);
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.click()}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const toInput = (f: FieldDef, raw: unknown): string | boolean => {
  if (f.type === "checkbox") return raw === true;
  if (raw === null || raw === undefined) {
    // A select that can't be blank starts on its first option.
    return f.type === "select" && f.notNullable ? (f.options?.[0]?.value ?? "") : "";
  }
  if (f.type === "money") return typeof raw === "number" ? (raw / 100).toFixed(2) : "";
  if (f.type === "date") return String(raw).slice(0, 10);
  return String(raw);
};

export function EntityForm(props: {
  meta: EntityMeta;
  id: string | null;
  record: Record<string, unknown>;
  /** Display names for lookup fields, keyed by field name. */
  lookupLabels?: Record<string, string>;
  readOnly?: boolean;
}) {
  const { meta, id, record, readOnly } = props;
  const initial: Values = Object.fromEntries(
    meta.fields.map((f) => [f.name, toInput(f, record[f.name])]),
  );
  const [values, setValues] = useState<Values>(initial);
  const [labels, setLabels] = useState(props.lookupLabels ?? {});
  const [result, setResult] = useState<CmdResult | null>(null);
  const [pending, start] = useTransition();
  const baseline = useRef(JSON.stringify(initial));
  const dirty = JSON.stringify(values) !== baseline.current;
  const formRef = useRef<HTMLFormElement>(null);

  const save = () =>
    start(async () => {
      const r = await saveRecordAction(meta.key, id, values);
      setResult(r ?? { ok: true, message: "Saved" });
      if (r?.ok) baseline.current = JSON.stringify(values);
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && !readOnly) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const issue = (name: string) =>
    result && !result.ok ? result.issues?.find((i) => i.path === name)?.message : undefined;
  const sections = [...new Set(meta.fields.map((f) => f.section))];

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="crm-commandbar">
        {!readOnly && (
          <button className="crm-btn crm-btn-primary" type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </button>
        )}
        <span className="crm-dirty" aria-live="polite">
          {dirty ? "● Unsaved changes" : id ? "Saved" : ""}
        </span>
      </div>
      {result && !result.ok && (
        <div role="alert" className="crm-error">
          {result.message}
        </div>
      )}
      {result?.ok && (
        <div role="status" className="crm-ok">
          {result.message}
        </div>
      )}
      {sections.map((s) => (
        <fieldset key={s} className="crm-section">
          <legend>{s}</legend>
          <div className="crm-fields">
            {meta.fields
              .filter((f) => f.section === s)
              .map((f) => {
                const err = issue(f.name);
                const common = {
                  id: `f-${f.name}`,
                  name: f.name,
                  disabled: readOnly,
                  "aria-invalid": err ? true : undefined,
                  "aria-describedby": err ? `e-${f.name}` : undefined,
                };
                const set = (v: string | boolean) => setValues((p) => ({ ...p, [f.name]: v }));
                const v = values[f.name];
                return (
                  <div key={f.name} className="crm-field">
                    <label htmlFor={`f-${f.name}`}>
                      {f.label}
                      {f.required && (
                        <span aria-hidden="true" className="crm-req">
                          {" "}
                          *
                        </span>
                      )}
                      {f.recommended && (
                        <span aria-hidden="true" className="crm-rec">
                          {" "}
                          +
                        </span>
                      )}
                    </label>
                    {f.type === "select" ? (
                      <select {...common} value={String(v)} onChange={(e) => set(e.target.value)}>
                        <option value="">—</option>
                        {f.options!.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        {...common}
                        value={String(v)}
                        onChange={(e) => set(e.target.value)}
                      />
                    ) : f.type === "checkbox" ? (
                      <input
                        {...common}
                        type="checkbox"
                        checked={v === true}
                        onChange={(e) => set(e.target.checked)}
                      />
                    ) : f.type === "lookup" ? (
                      <Lookup
                        field={f}
                        value={String(v)}
                        label={labels[f.name] ?? ""}
                        onPick={(pid, plabel) => {
                          set(pid);
                          setLabels((p) => ({ ...p, [f.name]: plabel }));
                        }}
                      />
                    ) : (
                      <input
                        {...common}
                        type={f.type === "money" || f.type === "number" ? "text" : f.type}
                        inputMode={
                          f.type === "money" || f.type === "number" ? "decimal" : undefined
                        }
                        value={String(v)}
                        onChange={(e) => set(e.target.value)}
                      />
                    )}
                    {f.hint && <small>{f.hint}</small>}
                    {err && (
                      <small id={`e-${f.name}`} className="crm-error-text">
                        {err}
                      </small>
                    )}
                  </div>
                );
              })}
          </div>
        </fieldset>
      ))}
    </form>
  );
}
