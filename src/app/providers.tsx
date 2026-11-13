"use client";

import { createContext, useCallback, useContext, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import {
  FluentProvider,
  createDarkTheme,
  createLightTheme,
  type BrandVariants,
} from "@fluentui/react-components";
import { THEME_COOKIE, type ThemeMode } from "@/lib/theme";

// Fluent only draws the forms on the sign-in pages; give them the Clinch orange (80 is the button
// colour, white text on it is 5.2:1) instead of Fluent's default blue.
const clinch: BrandVariants = {
  10: "#1f0b03",
  20: "#2e1006",
  30: "#431809",
  40: "#571f0d",
  50: "#6a260f",
  60: "#7c2d12",
  70: "#9a3412",
  80: "#c2410c",
  90: "#ea580c",
  100: "#f26a20",
  110: "#f97c3c",
  120: "#fb8a4d",
  130: "#fda070",
  140: "#fdb894",
  150: "#fed1b8",
  160: "#ffe8dc",
};
const lightTheme = createLightTheme(clinch);
const darkTheme = createDarkTheme(clinch);

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
        theme={dark ? darkTheme : lightTheme}
        style={{ minHeight: "100vh", background: "transparent", color: "inherit" }}
      >
        {children}
      </FluentProvider>
    </Ctx.Provider>
  );
}
