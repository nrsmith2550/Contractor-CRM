import Link from "next/link";
import { ENTITIES, recordTitle } from "@/entities";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { OPS } from "@/server/entities/registry";

// Global search: runs each entity's own (permission-scoped) list with the search text.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const user = await requireUser();
  const ctx = await buildCtx(user.tenantId, user.userId);
  const groups = q
    ? await Promise.all(
        Object.values(ENTITIES).map(async (meta) => {
          const view =
            meta.key === "lead"
              ? "all_open"
              : meta.key === "opportunity"
                ? "open"
                : meta.defaultView;
          const r = await OPS[meta.key].list(ctx, { view, search: q, limit: 10, offset: 0 });
          return { meta, rows: r.ok ? r.rows : [] };
        }),
      )
    : [];
  return (
    <>
      <h1>Search</h1>
      {!q && <p>Type something in the search box.</p>}
      {groups.map(({ meta, rows }) => (
        <section key={meta.key}>
          <h2>{meta.plural}</h2>
          {rows.length === 0 ? (
            <p>No matches.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/app/${meta.slug}/${r.id}`}>{recordTitle(meta, r)}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
