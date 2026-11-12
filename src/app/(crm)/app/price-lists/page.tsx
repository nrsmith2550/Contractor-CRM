import Link from "next/link";
import { InlineForm } from "@/components/form/InlineForm";
import { createPriceListAction } from "@/server/actions/quotes";
import { requireUser } from "@/server/auth/http";
import { listPriceLists } from "@/server/domain/catalog";
import { buildCtx } from "@/server/domain/context";

export default async function PriceListsPage() {
  const user = await requireUser();
  const res = await listPriceLists(await buildCtx(user.tenantId, user.userId));
  return (
    <>
      <h1>Price lists</h1>
      <p>
        A price list sets a product&apos;s price for the quotes that use it. Without one, the
        product&apos;s list price is used.
      </p>
      {res.ok && res.rows.length === 0 && <p>No price lists yet.</p>}
      {res.ok && (
        <ul>
          {res.rows.map((p) => (
            <li key={p.id}>
              <Link href={`/app/price-lists/${p.id}`}>{p.name}</Link> ({p.currency})
            </li>
          ))}
        </ul>
      )}
      <h2>New price list</h2>
      <InlineForm
        submitLabel="Create"
        resetOnSuccess={false}
        action={createPriceListAction}
        fields={[{ name: "name", label: "Name" }]}
      />
    </>
  );
}
