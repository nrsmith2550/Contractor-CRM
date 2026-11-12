import { notFound } from "next/navigation";
import { EntityForm } from "@/components/form/EntityForm";
import { entityBySlug } from "@/entities";

export default async function NewPage({ params }: { params: Promise<{ entity: string }> }) {
  const meta = entityBySlug((await params).entity);
  if (!meta) notFound();
  return (
    <>
      <h1>New {meta.singular.toLowerCase()}</h1>
      <EntityForm meta={meta} id={null} record={{}} />
    </>
  );
}
