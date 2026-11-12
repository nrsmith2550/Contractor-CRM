import { Board } from "@/components/pipeline/Board";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { pipeline } from "@/server/domain/opportunities";

export default async function PipelinePage() {
  const user = await requireUser();
  const res = await pipeline(await buildCtx(user.tenantId, user.userId));
  if (!res.ok)
    return (
      <div role="alert" className="crm-error">
        {res.message}
      </div>
    );
  return (
    <>
      <h1>Pipeline</h1>
      <Board
        columns={res.stages.map((s) => ({
          stage: s.stage,
          count: s.count,
          estRevenueCents: s.estRevenueCents,
          items: s.items.map((o) => ({
            id: o.id,
            name: o.name,
            opportunityNumber: o.opportunityNumber,
            estRevenueCents: o.estRevenueCents,
          })),
        }))}
      />
    </>
  );
}
