"use client";

import { useState, useTransition } from "react";
import { importLeadsAction, previewImportAction } from "@/server/actions/entities";

type Preview = Extract<Awaited<ReturnType<typeof previewImportAction>>, { ok: true }>;

export function ImportLeads({ fields }: { fields: { name: string; label: string }[] }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  // Which lead field each file column feeds, by column index ("" = skip).
  const [colField, setColField] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [report, setReport] = useState<unknown>(null);
  const [pending, start] = useTransition();

  return (
    <div>
      <label htmlFor="csv-file">CSV file</label>
      <input
        id="csv-file"
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const text = await f.text();
          setCsv(text);
          setReport(null);
          start(async () => {
            const p = await previewImportAction(text);
            if (p.ok) {
              setPreview(p);
              setColField(
                p.headers.map(
                  (_, i) => Object.entries(p.mapping).find(([, idx]) => idx === i)?.[0] ?? "",
                ),
              );
              setMsg("");
            } else {
              setPreview(null);
              setMsg(p.message);
            }
          });
        }}
      />
      {msg && (
        <div role="alert" className="crm-error">
          {msg}
        </div>
      )}
      {preview && (
        <>
          <p>{preview.rows} rows found. Map your columns to prospect fields:</p>
          <table className="crm-grid">
            <thead>
              <tr>
                <th>Column in file</th>
                <th>Example</th>
                <th>Prospect field</th>
              </tr>
            </thead>
            <tbody>
              {preview.headers.map((h, i) => (
                <tr key={`${h}-${i}`}>
                  <td>{h}</td>
                  <td>{preview.sample[0]?.[i]}</td>
                  <td>
                    <select
                      aria-label={`Field for ${h}`}
                      value={colField[i] ?? ""}
                      onChange={(e) =>
                        setColField((m) => m.map((x, j) => (j === i ? e.target.value : x)))
                      }
                    >
                      <option value="">(skip)</option>
                      {fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="crm-btn crm-btn-primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const mapping: Record<string, number> = {};
                colField.forEach((f, i) => f && (mapping[f] = i));
                const r = await importLeadsAction(csv, mapping);
                if (r.ok) setReport(r.report);
                else setMsg(r.message);
              })
            }
          >
            Import
          </button>
        </>
      )}
      {report !== null && (
        <div role="status" className="crm-ok">
          <pre>{JSON.stringify(report, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
