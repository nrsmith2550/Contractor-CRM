import { entityBySlug } from "@/entities";
import { buildCsv, buildXlsx } from "@/lib/xlsx";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { exportEntity } from "@/server/entities/export";
import { tenantTimeZone } from "@/server/entities/tenant";

export const dynamic = "force-dynamic";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Export to Excel / CSV: everything in the current view and search, not just the visible page. */
export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const meta = entityBySlug(entity);
  if (!meta) return new Response("Not found", { status: 404 });
  const user = await requireUser();
  const url = new URL(req.url);
  const view = meta.views.some((v) => v.id === url.searchParams.get("view"))
    ? url.searchParams.get("view")!
    : meta.defaultView;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";

  const res = await exportEntity(await buildCtx(user.tenantId, user.userId), meta, {
    view,
    search: (url.searchParams.get("q") ?? "").slice(0, 100),
    tz: await tenantTimeZone(user.tenantId),
    format,
  });
  if (!res.ok) {
    const status = res.code === "forbidden" ? 403 : 400;
    return Response.json({ error: res.message }, { status });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = `${meta.plural.toLowerCase().replace(/\s+/g, "-")}-${stamp}.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "private, no-store",
  };
  if (format === "csv") {
    return new Response(buildCsv(res.sheet), {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  }
  return new Response(buildXlsx(res.sheet) as unknown as BodyInit, {
    headers: { ...headers, "Content-Type": XLSX },
  });
}
