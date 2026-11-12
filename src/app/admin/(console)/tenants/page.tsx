import type { Metadata } from "next";
import { listTenants } from "@/server/admin/operations";

export const metadata: Metadata = { title: "Businesses" };

export default async function TenantsPage() {
  const tenants = await listTenants();
  return (
    <main>
      <h1>Businesses</h1>
      <table>
        <thead>
          <tr>
            {["Business", "Owner", "Tier", "Seats in use", "License", "Created"].map((h) => (
              <th key={h} align="left" style={{ paddingRight: 16 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.id}>
              <td>
                <a href={`/admin/tenants/${t.id}`}>{t.name}</a>
              </td>
              <td>{t.ownerEmail ?? "— none —"}</td>
              <td>{t.tier ?? "—"}</td>
              <td>
                {t.activeUsers} / {t.seatLimit ?? "—"}
              </td>
              <td>{t.licenseStatus ?? "—"}</td>
              <td>{t.createdAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tenants.length === 0 ? <p>No businesses yet.</p> : null}
    </main>
  );
}
