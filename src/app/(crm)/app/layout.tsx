import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireUser } from "@/server/auth/http";
import { SignOutButton } from "../../(auth)/auth-forms";

// Placeholder shell: the real Dynamics-style app shell (top bar, site map, area switcher)
// arrives in Phase 2. What matters here is the gate: every request re-validates the session,
// the user and the license, and a forced password change blocks everything else.
export default async function CrmLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 16px",
          background: "#1b1a19",
          color: "#fff",
        }}
      >
        <strong>CRM</strong>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span>{user.fullName}</span>
          <SignOutButton />
        </span>
      </header>
      {children}
    </div>
  );
}
