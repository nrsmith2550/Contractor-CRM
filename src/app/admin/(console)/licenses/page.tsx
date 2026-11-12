import type { Metadata } from "next";
import { TIER_IDS, TIERS, formatUsd } from "@/lib/tiers";
import { licenseStatusAction, mintLicenseAction } from "@/server/actions/admin";
import { listLicenses } from "@/server/admin/operations";
import { AdminActionForm, REASON_FIELD } from "../../admin-forms";

export const metadata: Metadata = { title: "Licenses" };

const tierOptions = TIER_IDS.map((t) => ({
  value: t,
  label: `${TIERS[t].label} — ${TIERS[t].seats}`,
}));
const statusOptions = [
  { value: "suspend", label: "Suspend" },
  { value: "revoke", label: "Revoke" },
  { value: "reinstate", label: "Reinstate" },
];

export default async function LicensesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const licenses = await listLicenses({ q, status });
  return (
    <main>
      <h1>Licenses</h1>

      <h2>Mint a license</h2>
      <p>For demos, resellers, comps and custom quotes over 100 users. The key is shown once.</p>
      <AdminActionForm
        action={mintLicenseAction}
        submitLabel="Mint license"
        clearOnSuccess
        fields={[
          { name: "tier", label: "Tier", type: "select", options: tierOptions, required: true },
          { name: "buyerEmail", label: "Buyer email (optional)", type: "email" },
          {
            name: "seatLimit",
            label: "Seat limit override (optional)",
            type: "number",
            hint: "Leave blank to use the tier's limit",
          },
          REASON_FIELD,
        ]}
      />

      <h2>All licenses</h2>
      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input name="q" defaultValue={q} placeholder="Buyer email, key ending, business" />
        <select name="status" defaultValue={status ?? ""}>
          <option value="">Any status</option>
          {["issued", "active", "suspended", "revoked"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead>
          <tr>
            {["Key", "Tier", "Seats", "Status", "Buyer", "Business", "Paid", "Created", ""].map(
              (h) => (
                <th key={h} align="left" style={{ paddingRight: 16 }}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {licenses.map((l) => (
            <tr key={l.id} style={{ verticalAlign: "top" }}>
              <td>…{l.keyLast5}</td>
              <td>{l.tier}</td>
              <td>{l.seatLimit}</td>
              <td>{l.status}</td>
              <td>{l.buyerEmail ?? "—"}</td>
              <td>
                {l.tenantId ? <a href={`/admin/tenants/${l.tenantId}`}>{l.tenantName}</a> : "—"}
              </td>
              <td>{formatUsd(l.amountPaidCents)}</td>
              <td>{l.createdAt.toISOString().slice(0, 10)}</td>
              <td>
                <details>
                  <summary>Change status</summary>
                  <AdminActionForm
                    action={licenseStatusAction}
                    fixed={{ licenseId: l.id }}
                    submitLabel="Apply"
                    fields={[
                      { name: "action", label: "Action", type: "select", options: statusOptions },
                      REASON_FIELD,
                    ]}
                  />
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {licenses.length === 0 ? <p>No licenses match.</p> : null}
    </main>
  );
}
