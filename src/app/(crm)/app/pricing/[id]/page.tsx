import { notFound } from "next/navigation";
import { InlineForm } from "@/components/form/InlineForm";
import { formatMoney } from "@/lib/format";
import { setPriceAction } from "@/server/actions/quotes";
import { requireUser } from "@/server/auth/http";
import { listPriceListItems, listPriceLists, listProducts } from "@/server/domain/catalog";
import { buildCtx } from "@/server/domain/context";

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const [lists, items, products] = await Promise.all([
    listPriceLists(ctx),
    listPriceListItems(ctx, id),
    listProducts(ctx, { limit: 200 }),
  ]);
  const list = lists.ok ? lists.rows.find((l) => l.id === id) : undefined;
  if (!list || !items.ok) notFound();
  return (
    <>
      <h1>{list.name}</h1>
      <table className="crm-grid">
        <caption className="crm-sr">Prices</caption>
        <thead>
          <tr>
            <th scope="col">SKU</th>
            <th scope="col">Product or service</th>
            <th scope="col">Price</th>
          </tr>
        </thead>
        <tbody>
          {items.rows.length === 0 && (
            <tr>
              <td colSpan={3}>No prices yet.</td>
            </tr>
          )}
          {items.rows.map((i) => (
            <tr key={i.productId}>
              <td>{i.sku}</td>
              <td>{i.name}</td>
              <td>{formatMoney(i.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Set a price</h2>
      <InlineForm
        submitLabel="Save price"
        action={setPriceAction.bind(null, id)}
        fields={[
          {
            name: "productId",
            label: "Product or service",
            type: "select",
            options: [
              { value: "", label: "Choose a product or service" },
              ...(products.ok
                ? products.rows.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))
                : []),
            ],
          },
          { name: "price", label: "Price ($)", inputMode: "decimal" },
        ]}
      />
    </>
  );
}
