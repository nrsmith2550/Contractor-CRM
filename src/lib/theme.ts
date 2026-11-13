// Light / dark / follow-the-device. The choice is kept in a cookie so the server can render the
// right colours on the first paint (no flash), and it works before anyone signs in.

export type ThemeMode = "light" | "dark" | "system";
export const THEME_COOKIE = "clinch-theme";
export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

export const parseTheme = (v: unknown): ThemeMode =>
  v === "light" || v === "dark" || v === "system" ? v : "system";
