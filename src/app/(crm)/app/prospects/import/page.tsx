import { ImportLeads } from "@/components/form/ImportLeads";
import { requireUser } from "@/server/auth/http";
import { IMPORT_FIELDS } from "@/server/domain/lead-import";
import { humanize } from "@/lib/format";

export default async function ImportPage() {
  await requireUser();
  return (
    <>
      <h1>Import prospects</h1>
      <ImportLeads
        fields={IMPORT_FIELDS.map((f) => ({
          name: f,
          label: humanize(f.replace(/([A-Z])/g, " $1").toLowerCase()),
        }))}
      />
    </>
  );
}
