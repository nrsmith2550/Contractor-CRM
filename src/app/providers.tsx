"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { THEME_COOKIE, type ThemeMode } from "@/lib/theme";

const Ctx = createContext<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>({
  mode: "system",
  setMode: () => {},
});
export const useTheme = () => useContext(Ctx);

const query = "(prefers-color-scheme: dark)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const prefersDark = () => window.matchMedia(query).matches;

export function Providers({ children, initial }: { children: ReactNode; initial: ThemeMode }) {
  const [mode, setModeState] = useState<ThemeMode>(initial);
  const deviceDark = useSyncExternalStore(subscribe, prefersDark, () => false);
  const dark = mode === "dark" || (mode === "system" && deviceDark);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    document.documentElement.dataset.theme = m;
    try {
      document.cookie = `${THEME_COOKIE}=${m}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      /* cookies blocked: the choice just won't be remembered */
    }
  }, []);

  return (
    <Ctx.Provider value={{ mode, setMode }}>
      {/* Our own tokens colour the page; Fluent only needs to match for its form controls. */}
      <FluentProvider
        theme={dark ? webDarkTheme : webLightTheme}
        style={{ minHeight: "100vh", background: "transparent", color: "inherit" }}
      >
        {children}
      </FluentProvider>
    </Ctx.Provider>
  );
}
