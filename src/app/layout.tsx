import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { Providers } from "./providers";
import "./theme.css";

export const metadata: Metadata = {
  title: { default: "Clinch CRM", template: "%s · Clinch CRM" },
  description: "Customer management for small businesses.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const mode = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={mode}>
      <body>
        <Providers initial={mode}>{children}</Providers>
      </body>
    </html>
  );
}
