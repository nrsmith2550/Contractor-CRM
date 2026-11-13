import { InlineForm } from "@/components/form/InlineForm";
import { createQuoteAction } from "@/server/actions/quotes";
import { requireUser } from "@/server/auth/http";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ opportunityId?: string }>;
}) {
  await requireUser();
  const { opportunityId } = await searchParams;
  return (
    <>
      <h1>New quote</h1>
      <p>
        Give the quote a name. Customer details are copied from the deal when you start from one.
      </p>
      <InlineForm
        submitLabel="Create quote"
        resetOnSuccess={false}
        action={createQuoteAction.bind(null, opportunityId ?? "")}
        fields={[{ name: "name", label: "Name" }]}
      />
    </>
  );
}
