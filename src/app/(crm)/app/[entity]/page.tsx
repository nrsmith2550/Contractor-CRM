import { notFound } from "next/navigation";
import { EntityGrid, PAGE_SIZE } from "@/components/grid/EntityGrid";
import { entityBySlug } from "@/entities";
import { tenantTimeZone } from "@/server/entities/tenant";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { OPS } from "@/server/entities/registry";

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ view?: string; q?: string; page?: string }>;
}) {
  const [{ entity }, sp] = await Promise.all([params, searchParams]);
  const meta = entityBySlug(entity);
  if (!meta) notFound();
  const user = await requireUser();
  const view = meta.views.some((v) => v.id === sp.view) ? sp.view! : meta.defaultView;
  const page = Math.max(1, Number(sp.page) || 1);
  const search = (sp.q ?? "").slice(0, 100);
  const res = await OPS[meta.key].list(await buildCtx(user.tenantId, user.userId), {
    view,
    search,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  return (
    <>
      <h1>{meta.plural}</h1>
      {res.ok ? (
        <EntityGrid
          meta={meta}
          rows={res.rows}
          total={res.total}
          view={view}
          search={search}
          page={page}
          tz={await tenantTimeZone(user.tenantId)}
        />
      ) : (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      )}
    </>
  );
}
