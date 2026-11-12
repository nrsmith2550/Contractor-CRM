import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main style={{ maxWidth: 440, margin: "0 auto", padding: "48px 16px" }}>{children}</main>;
}
