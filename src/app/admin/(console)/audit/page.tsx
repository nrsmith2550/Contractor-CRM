import type { Metadata } from "next";
import { listAdminAudit } from "@/server/admin/operations";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const rows = await listAdminAudit(200);
  return (
    <main>
      <h1>Audit log</h1>
      <p>
        Every administrative action: who, what, when, from where, and why. Entries can&apos;t be
        edited or deleted.
      </p>
      <table>
        <thead>
          <tr>
            {["When (UTC)", "Admin", "Action", "Target", "Reason", "IP"].map((h) => (
              <th key={h} align="left" style={{ paddingRight: 16 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ verticalAlign: "top" }}>
              <td>{r.at.toISOString().replace("T", " ").slice(0, 19)}</td>
              <td>{r.adminEmail ?? "system"}</td>
              <td>{r.action}</td>
              <td>
                {r.targetType} {r.targetId?.slice(0, 8)}
              </td>
              <td>{r.reason ?? ""}</td>
              <td>{r.ip ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 ? <p>Nothing yet.</p> : null}
    </main>
  );
}
