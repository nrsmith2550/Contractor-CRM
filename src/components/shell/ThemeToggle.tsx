"use client";

import { useTheme } from "@/app/providers";
import { THEME_MODES, parseTheme } from "@/lib/theme";

const LABEL = { system: "Match device", light: "Light", dark: "Dark" } as const;

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <label className="crm-theme">
      Theme
      <select value={mode} onChange={(e) => setMode(parseTheme(e.target.value))}>
        {THEME_MODES.map((m) => (
          <option key={m} value={m}>
            {LABEL[m]}
          </option>
        ))}
      </select>
    </label>
  );
}
