import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { buildQuotePdf } from "@/server/pdf/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  let res;
  try {
    res = await buildQuotePdf(await buildCtx(user.tenantId, user.userId), (await params).id);
  } catch (err) {
    console.error("quote pdf failed", err instanceof Error ? (err.stack ?? err.message) : err);
    return Response.json({ error: "Couldn't generate the PDF." }, { status: 500 });
  }
  if (!res.ok) {
    const status = res.code === "not_found" ? 404 : res.code === "forbidden" ? 403 : 409;
    return Response.json({ error: res.message }, { status });
  }
  return new Response(new Uint8Array(res.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${res.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
