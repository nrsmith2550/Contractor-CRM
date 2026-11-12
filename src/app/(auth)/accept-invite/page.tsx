import type { Metadata } from "next";
import { getInvitationPreview } from "@/server/auth/invitations";
import { AcceptInviteForm } from "../auth-forms";

export const metadata: Metadata = { title: "Join your team" };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const preview = await getInvitationPreview(token);
  if (!token || !preview) {
    return (
      <>
        <h1>This invitation isn&apos;t valid</h1>
        <p>It may have expired or already been used. Ask your administrator for a new one.</p>
        <p>
          <a href="/login">Sign in</a>
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Join {preview.companyName}</h1>
      <p>
        You&apos;re joining as <strong>{preview.email}</strong>. Choose your name and a password.
      </p>
      <AcceptInviteForm token={token} />
    </>
  );
}
