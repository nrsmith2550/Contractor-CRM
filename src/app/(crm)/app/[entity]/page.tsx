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
  const chosen = meta.views.some((v) => v.id === sp.view);
  let view = chosen ? sp.view! : meta.defaultView;
  const page = Math.max(1, Number(sp.page) || 1);
  const search = (sp.q ?? "").slice(0, 100);
  const ctx = await buildCtx(user.tenantId, user.userId);
  const load = (v: string) =>
    OPS[meta.key].list(ctx, { view: v, search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  let res = await load(view);
  // Nothing of your own yet (common for an owner or manager): show the wider list rather than a blank page.
  let widened = false;
  if (res.ok && res.total === 0 && !chosen && !search && meta.fallbackView) {
    const wider = await load(meta.fallbackView);
    if (wider.ok && wider.total > 0) {
      res = wider;
      view = meta.fallbackView;
      widened = true;
    }
  }
  return (
    <>
      <h1>{meta.plural}</h1>
      {res.ok ? (
        <EntityGrid
          meta={meta}
          rows={res.rows}
          total={res.total}
          view={view}
          widened={widened}
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
