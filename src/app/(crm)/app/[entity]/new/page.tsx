import { notFound } from "next/navigation";
import { EntityForm } from "@/components/form/EntityForm";
import { entityBySlug } from "@/entities";
import { requireUser } from "@/server/auth/http";
import { buildCtx } from "@/server/domain/context";
import { withDynamicOptions } from "@/server/entities/registry";

export default async function NewPage({ params }: { params: Promise<{ entity: string }> }) {
  const meta = entityBySlug((await params).entity);
  if (!meta) notFound();
  const user = await requireUser();
  const full = await withDynamicOptions(await buildCtx(user.tenantId, user.userId), meta);
  return (
    <>
      <h1>New {meta.singular.toLowerCase()}</h1>
      <EntityForm meta={full} id={null} record={{}} />
    </>
  );
}
