import Link from "next/link";
import { formatMoney, humanize } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { listOrders } from "@/server/domain/quotes";

export default async function OrdersPage() {
  const user = await requireUser();
  const res = await listOrders(await buildCtx(user.tenantId, user.userId));
  return (
    <>
      <h1>Orders</h1>
      <p>Orders are created when a quote is won.</p>
      {!res.ok ? (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      ) : (
        <table className="crm-grid">
          <caption className="crm-sr">Orders</caption>
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {res.rows.length === 0 && (
              <tr>
                <td colSpan={4}>No orders yet.</td>
              </tr>
            )}
            {res.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/orders/${r.id}`}>{r.orderNumber}</Link>
                </td>
                <td>{r.name}</td>
                <td>
                  <span className="crm-badge">{humanize(r.fulfillmentStatus)}</span>
                </td>
                <td>{formatMoney(r.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
