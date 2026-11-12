"use client";

import type { ReactNode } from "react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <FluentProvider theme={webLightTheme} style={{ minHeight: "100vh" }}>
      {children}
    </FluentProvider>
  );
}
