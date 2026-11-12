import type { Metadata } from "next";
import { requireUser } from "@/server/auth/http";
import { ChangePasswordForm } from "../auth-forms";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser();
  return (
    <>
      <h1>Change your password</h1>
      {user.mustChangePassword ? (
        <p>For your security, choose a new password before you continue.</p>
      ) : null}
      <ChangePasswordForm />
    </>
  );
}
