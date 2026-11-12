"use client";

import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  Textarea,
} from "@fluentui/react-components";
import { useState, type FormEvent } from "react";
import type { AdminActionResult } from "@/server/actions/admin";

export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "email" | "password" | "number" | "textarea" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  defaultValue?: string;
};

/**
 * One form component for every admin action. `fixed` carries hidden values (ids, the chosen
 * action). A result that includes a `secret` (a minted key, a temporary password) is shown once
 * with a copy button and is not kept anywhere else.
 */
export function AdminActionForm(props: {
  action: (values: Record<string, string>) => Promise<AdminActionResult>;
  fields: FieldDef[];
  fixed?: Record<string, string>;
  submitLabel: string;
  confirmText?: string;
  danger?: boolean;
  clearOnSuccess?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (props.confirmText && !window.confirm(props.confirmText)) return;
    const form = e.currentTarget;
    const values: Record<string, string> = { ...props.fixed };
    for (const [k, v] of new FormData(form).entries()) values[k] = String(v);
    setPending(true);
    setResult(null);
    setCopied(false);
    try {
      const res = await props.action(values);
      setResult(res);
      if (res.ok && props.clearOnSuccess) form.reset();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}
    >
      {result ? (
        <MessageBar intent={result.ok ? "success" : "error"} role={result.ok ? "status" : "alert"}>
          <MessageBarBody>{result.message}</MessageBarBody>
        </MessageBar>
      ) : null}
      {result?.ok && result.secret ? (
        <div
          style={{
            border: "1px solid #c7a600",
            background: "#fffbe6",
            padding: 12,
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 12, marginBottom: 4 }}>{result.secret.label} — shown once</div>
          <code
            data-testid="one-time-secret"
            style={{ fontSize: 18, letterSpacing: 1, wordBreak: "break-all" }}
          >
            {result.secret.value}
          </code>
          <div style={{ marginTop: 8 }}>
            <Button
              size="small"
              type="button"
              onClick={async () => {
                await navigator.clipboard?.writeText(result.secret!.value);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}
      {props.fields.map((f) => (
        <Field key={f.name} label={f.label} required={f.required} hint={f.hint}>
          {f.type === "select" ? (
            <Select name={f.name} defaultValue={f.defaultValue}>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : f.type === "textarea" ? (
            <Textarea name={f.name} rows={2} defaultValue={f.defaultValue} />
          ) : (
            <Input
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete ?? "off"}
              inputMode={f.inputMode}
              defaultValue={f.defaultValue}
            />
          )}
        </Field>
      ))}
      <Button
        appearance={props.danger ? "secondary" : "primary"}
        type="submit"
        disabled={pending}
        style={props.danger ? { borderColor: "#a4262c", color: "#a4262c" } : undefined}
      >
        {pending ? "Working…" : props.submitLabel}
      </Button>
    </form>
  );
}

export const REASON_FIELD: FieldDef = {
  name: "reason",
  label: "Reason (kept in the audit log)",
  type: "textarea",
  required: true,
  hint: "At least 5 characters",
};
