"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CmdResult } from "@/server/actions/entities";

export type InlineField = {
  name: string;
  label: string;
  type?: "text" | "select";
  placeholder?: string;
  options?: { value: string; label: string }[];
  defaultValue?: string;
  inputMode?: "decimal";
};

/** A small labelled form that runs one server action; shows its error or confirmation. */
export function InlineForm(props: {
  fields: InlineField[];
  submitLabel: string;
  action: (values: Record<string, string>) => Promise<CmdResult | void>;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const init = Object.fromEntries(props.fields.map((f) => [f.name, f.defaultValue ?? ""]));
  const [v, setV] = useState<Record<string, string>>(init);
  const [res, setRes] = useState<CmdResult | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="crm-panel"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await props.action(v);
          if (!r) return; // the action redirected
          setRes(r);
          if (r.ok) {
            if (props.resetOnSuccess !== false) setV(init);
            router.refresh();
          }
        });
      }}
    >
      {props.fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.type === "select" ? (
            <select value={v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
              {f.options!.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={v[f.name]}
              placeholder={f.placeholder}
              inputMode={f.inputMode}
              onChange={(e) => setV({ ...v, [f.name]: e.target.value })}
            />
          )}
        </label>
      ))}
      <button className="crm-btn crm-btn-primary" type="submit" disabled={pending}>
        {props.submitLabel}
      </button>
      {res && !res.ok && (
        <div role="alert" className="crm-error" style={{ flexBasis: "100%" }}>
          {res.message}
        </div>
      )}
      {res?.ok && res.message && (
        <div role="status" className="crm-ok" style={{ flexBasis: "100%" }}>
          {res.message}
        </div>
      )}
    </form>
  );
}
