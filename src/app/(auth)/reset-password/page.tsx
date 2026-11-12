import type { Metadata } from "next";
import { isResetTokenUsable } from "@/server/auth/reset";
import { ResetPasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  // Show a dead-end message instead of a form that can never succeed.
  if (!token || !(await isResetTokenUsable(token))) {
    return (
      <>
        <h1>This link has expired</h1>
        <p>Reset links work once and expire after 30 minutes.</p>
        <p>
          <a href="/forgot-password">Request a new link</a>
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Choose a new password</h1>
      <ResetPasswordForm token={token} />
    </>
  );
}
