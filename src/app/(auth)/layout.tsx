import type { ReactNode } from "react";
import { Brand } from "@/components/shell/Brand";
import "../crm.css";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main style={{ maxWidth: 440, margin: "0 auto", padding: "48px 16px" }}>
      <div className="public-brand">
        <Brand />
      </div>
      {children}
    </main>
  );
}
