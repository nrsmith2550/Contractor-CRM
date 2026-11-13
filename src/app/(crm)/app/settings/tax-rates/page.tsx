import { InlineForm } from "@/components/form/InlineForm";
import { createTaxRateAction } from "@/server/actions/quotes";
import { requireUser } from "@/server/auth/http";
import { listTaxRates } from "@/server/domain/catalog";
import { buildCtx } from "@/server/domain/context";

export default async function TaxRatesPage() {
  const user = await requireUser();
  const res = await listTaxRates(await buildCtx(user.tenantId, user.userId));
  return (
    <>
      <h1>Tax rates</h1>
      <p>Assign a tax rate to a product or service and it is applied to its quote lines.</p>
      {res.ok && res.rows.length === 0 && <p>No tax rates yet.</p>}
      {res.ok && (
        <ul>
          {res.rows.map((r) => (
            <li key={r.id}>
              {r.name}: {(r.rateBp / 100).toFixed(2)}%
            </li>
          ))}
        </ul>
      )}
      <h2>Add a tax rate</h2>
      <InlineForm
        submitLabel="Add"
        action={createTaxRateAction}
        fields={[
          { name: "name", label: "Name", placeholder: "State sales tax" },
          { name: "percent", label: "Rate (%)", placeholder: "8.25", inputMode: "decimal" },
        ]}
      />
    </>
  );
}
