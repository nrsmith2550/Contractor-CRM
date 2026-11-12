import Link from "next/link";
import { formatMoney, humanize } from "@/lib/format";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { listQuotes } from "@/server/domain/quotes";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const search = ((await searchParams).q ?? "").slice(0, 100);
  const user = await requireUser();
  const res = await listQuotes(await buildCtx(user.tenantId, user.userId), { search, limit: 50 });
  return (
    <>
      <h1>Quotes</h1>
      <div className="crm-commandbar">
        <Link className="crm-btn crm-btn-primary" href="/app/quotes/new">
          + New
        </Link>
        <form method="get" className="crm-row">
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search quotes"
            aria-label="Search"
          />
          <button className="crm-btn" type="submit">
            Search
          </button>
        </form>
      </div>
      {!res.ok ? (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      ) : (
        <table className="crm-grid">
          <caption className="crm-sr">Quotes</caption>
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
                <td colSpan={4}>No quotes yet.</td>
              </tr>
            )}
            {res.rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/quotes/${r.id}`}>{r.quoteNumber}</Link>
                </td>
                <td>{r.name}</td>
                <td>
                  <span className="crm-badge">{humanize(r.status)}</span>
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
