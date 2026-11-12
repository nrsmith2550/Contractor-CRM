import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminVerifyAction } from "@/server/actions/admin";
import { getCurrentAdmin } from "@/server/admin/http";
import { AdminActionForm } from "../../admin-forms";

export const metadata: Metadata = { title: "Verify" };

export default async function AdminVerifyPage() {
  const session = await getCurrentAdmin();
  if (session.ok) redirect("/admin");
  if (!session.ok && session.reason !== "pending") redirect("/admin/login");
  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "64px 16px" }}>
      <h1>Enter your code</h1>
      <p>Open your authenticator app and enter the 6-digit code for this account.</p>
      <AdminActionForm
        action={adminVerifyAction}
        submitLabel="Verify"
        fields={[
          {
            name: "code",
            label: "6-digit code",
            required: true,
            inputMode: "numeric",
            autoComplete: "one-time-code",
          },
        ]}
      />
      <p>
        <a href="/admin/login">Start over</a>
      </p>
    </main>
  );
}
