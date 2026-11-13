import type { Article, Block } from "./types";

const stripMarkup = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*/g, "");

export function blockText(b: Block): string {
  switch (b.type) {
    case "h":
    case "p":
    case "tip":
    case "note":
    case "warning":
      return stripMarkup(b.text);
    case "steps":
    case "list":
      return b.items.map(stripMarkup).join(" ");
    case "table":
      return [b.caption, ...b.head, ...b.rows.flat()].map(stripMarkup).join(" ");
    case "flow":
      return [b.caption, ...b.steps.flatMap((s) => [s.title, s.text])].map(stripMarkup).join(" ");
  }
}

export const articleText = (a: Article): string => a.body.map(blockText).join(" ");

const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * Plain keyword search: every word typed must appear somewhere in the article; a hit in the title
 * counts most, then the summary, then the body. Ranked best first. Never throws on odd input.
 */
export function searchArticles(all: Article[], query: string): Article[] {
  const terms = words(query.slice(0, 100));
  if (terms.length === 0) return [];
  const scored: { a: Article; score: number }[] = [];
  for (const a of all) {
    const title = a.title.toLowerCase();
    const summary = a.summary.toLowerCase();
    const body = articleText(a).toLowerCase();
    let score = 0;
    let all_ = true;
    for (const t of terms) {
      const inTitle = title.includes(t);
      const inSummary = summary.includes(t);
      const inBody = body.includes(t);
      if (!inTitle && !inSummary && !inBody) {
        all_ = false;
        break;
      }
      score += (inTitle ? 5 : 0) + (inSummary ? 2 : 0) + (inBody ? 1 : 0);
    }
    if (all_) scored.push({ a, score });
  }
  return scored
    .sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title))
    .map((s) => s.a);
}
