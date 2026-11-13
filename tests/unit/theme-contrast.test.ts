import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTheme } from "@/lib/theme";

// Reads the real colour tokens from src/app/theme.css and checks every text/background pairing the
// app uses meets WCAG AA (4.5:1 for normal text), in both themes.

const css = readFileSync("src/app/theme.css", "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("\n}", open));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = tokens(':root,\n:root[data-theme="light"]');
const dark = tokens(':root[data-theme="dark"]');

function rgb(c: string, over?: [number, number, number]): [number, number, number] {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = null;
  const a = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(c);
  if (a && over) {
    const al = Number(a[4]);
    return [0, 1, 2].map((i) => Math.round(Number(a[i + 1]) * al + over[i]! * (1 - al))) as [
      number,
      number,
      number,
    ];
  }
  throw new Error(`can't read colour ${c}`);
}
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

// [text token, background token]
const PAIRS: [string, string][] = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-2"],
  ["text", "hover"],
  ["text", "badge-bg"],
  ["text", "done-bg"],
  ["text", "warn-bg"],
  ["text", "today-bg"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["muted", "surface-2"],
  ["muted", "hover"],
  ["accent-text", "bg"],
  ["accent-text", "surface"],
  ["accent-text", "surface-2"],
  ["on-accent", "accent"],
  ["on-accent", "accent-hover"],
  ["danger", "danger-bg"],
  ["danger", "surface"],
  ["ok", "ok-bg"],
  ["ok", "badge-bg"],
  ["danger", "badge-bg"],
  ["warn-text", "badge-bg"],
  ["warn-text", "surface"],
  ["muted", "badge-bg"],
  ["ok", "surface"],
  ["nav-text", "nav-bg"],
  ["nav-muted", "nav-bg"],
  ["on-accent", "ev-blue"],
  ["on-accent", "ev-orange"],
  ["on-accent", "ev-green"],
  ["on-accent", "ev-grey"],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (_name, t) => {
  const get = (k: string) => {
    // Dark inherits tokens it doesn't override (accent, ev-*, on-accent...) from the base set.
    const v = t[k] ?? light[k];
    if (!v) throw new Error(`missing token --${k}`);
    return v;
  };
  it.each(PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(rgb(get(fg)), rgb(get(bg)))).toBeGreaterThanOrEqual(4.5);
  });
  it("the active nav item stays readable on its tinted background", () => {
    const navBg = rgb(get("nav-bg"));
    const tinted = rgb(get("nav-active-bg"), navBg);
    expect(ratio(rgb(get("nav-active-text")), tinted)).toBeGreaterThanOrEqual(4.5);
  });
  it("focus rings are visible against the page and cards (3:1)", () => {
    for (const bg of ["bg", "surface"]) {
      expect(ratio(rgb(get("focus")), rgb(get(bg)))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("the system theme", () => {
  it("repeats the dark values so a dark device gets the same colours", () => {
    const sys = tokens('  :root[data-theme="system"]');
    for (const [k, v] of Object.entries(sys)) {
      if (k in dark) expect(`${k}=${v}`).toBe(`${k}=${dark[k]}`);
    }
    expect(Object.keys(sys).length).toBeGreaterThan(10);
  });
});

describe("parseTheme", () => {
  it("accepts the three modes and defaults anything else to system", () => {
    expect(["light", "dark", "system"].map(parseTheme)).toEqual(["light", "dark", "system"]);
    expect([undefined, "", "blue", 5, null].map(parseTheme)).toEqual(Array(5).fill("system"));
  });
});
