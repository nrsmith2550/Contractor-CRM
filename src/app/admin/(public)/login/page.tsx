import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminLoginAction } from "@/server/actions/admin";
import { getCurrentAdmin } from "@/server/admin/http";
import { AdminActionForm } from "../../admin-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function AdminLoginPage() {
  const session = await getCurrentAdmin();
  if (session.ok) redirect("/admin");
  if (session.reason === "pending") redirect("/admin/verify");
  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "64px 16px" }}>
      <h1>Platform admin</h1>
      <p>Sign in with your password, then your authenticator code.</p>
      <AdminActionForm
        action={adminLoginAction}
        submitLabel="Continue"
        fields={[
          {
            name: "email",
            label: "Email",
            type: "email",
            required: true,
            autoComplete: "username",
          },
          {
            name: "password",
            label: "Password",
            type: "password",
            required: true,
            autoComplete: "current-password",
          },
        ]}
      />
    </main>
  );
}
