import Link from "next/link";
import type { EntityMeta } from "@/entities/types";
import { SlaBadge } from "@/components/grid/SlaBadge";
import { formatDate, formatMoney, humanize } from "@/lib/format";
import type { Row } from "@/server/entities/registry";

export const PAGE_SIZE = 25;

const cell = (col: EntityMeta["columns"][number], row: Row, tz: string) => {
  const v = row[col.name];
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "money") return formatMoney(v);
  if (col.type === "date") return formatDate(v, tz);
  if (col.type === "sla") {
    return (
      <SlaBadge
        status={String(row.status)}
        createdAt={row.createdAt as Date}
        slaDueAt={(row.slaDueAt as Date | null) ?? null}
        resolvedAt={(row.resolvedAt as Date | null) ?? null}
      />
    );
  }
  if (col.type === "badge") return <span className="crm-badge">{humanize(String(v))}</span>;
  return String(v);
};

/** Metadata-driven list: view selector, search and paging are plain GET forms (work without JS). */
export function EntityGrid(props: {
  meta: EntityMeta;
  rows: Row[];
  total: number;
  view: string;
  search: string;
  page: number;
  tz: string;
}) {
  const { meta, rows, total, view, search, page, tz } = props;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) =>
    `/app/${meta.slug}?view=${encodeURIComponent(view)}&q=${encodeURIComponent(search)}&page=${p}`;
  const exportHref = (format: string) =>
    `/app/${meta.slug}/export?view=${encodeURIComponent(view)}&q=${encodeURIComponent(search)}&format=${format}`;
  const first = meta.columns[0]!.name;

  return (
    <section aria-label={`${meta.plural} list`}>
      <div className="crm-commandbar">
        <Link className="crm-btn crm-btn-primary" href={`/app/${meta.slug}/new`}>
          + New
        </Link>
        {meta.key === "lead" && (
          <Link className="crm-btn" href="/app/leads/import">
            Import leads
          </Link>
        )}
        <a className="crm-btn" href={exportHref("xlsx")}>
          Export to Excel
        </a>
        <a className="crm-btn" href={exportHref("csv")}>
          Export to CSV
        </a>
        <form method="get" className="crm-row">
          <label>
            <span className="crm-sr">View</span>
            <select name="view" defaultValue={view} aria-label="View">
              {meta.views.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search this view"
            aria-label="Search"
          />
          <button className="crm-btn" type="submit">
            Apply
          </button>
        </form>
      </div>
      <table className="crm-grid">
        <caption className="crm-sr">
          {meta.views.find((v) => v.id === view)?.label ?? meta.plural}
        </caption>
        <thead>
          <tr>
            {meta.columns.map((c) => (
              <th key={c.name} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={meta.columns.length}>
                No {meta.plural.toLowerCase()} to show in this view.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.id}>
              {meta.columns.map((c) => (
                <td key={c.name}>
                  {c.name === first || c.name === meta.titleFields[0] ? (
                    <Link href={`/app/${meta.slug}/${r.id}`}>{cell(c, r, tz) || "(none)"}</Link>
                  ) : (
                    cell(c, r, tz)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <nav className="crm-row crm-pager" aria-label="Pages">
        <span>
          {total} record{total === 1 ? "" : "s"} · page {page} of {pages}
        </span>
        {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
        {page < pages && <Link href={href(page + 1)}>Next</Link>}
      </nav>
    </section>
  );
}
