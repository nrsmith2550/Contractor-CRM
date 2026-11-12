import type { Metadata } from "next";
import { dashboardStats } from "@/server/admin/operations";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const s = await dashboardStats();
  const cards: [string, number][] = [
    ["Businesses", s.tenants],
    ["Active licenses", s.active],
    ["Issued, not yet activated", s.issued],
    ["Suspended", s.suspended],
    ["Revoked", s.revoked],
  ];
  return (
    <main>
      <h1>Overview</h1>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {cards.map(([label, n]) => (
          <div
            key={label}
            style={{ border: "1px solid #c8c6c4", borderRadius: 4, padding: 16, minWidth: 160 }}
          >
            <div style={{ fontSize: 28, fontWeight: 600 }}>{n}</div>
            <div>{label}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
