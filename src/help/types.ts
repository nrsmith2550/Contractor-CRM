// The help centre's content is plain data, so it can be searched, checked by tests, and kept in step
// with the product. Text may use [label](/app/path) links and **bold**; nothing else.

export type Block =
  | { type: "h"; text: string }
  | { type: "p"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "tip" | "note" | "warning"; text: string }
  | { type: "table"; caption: string; head: string[]; rows: string[][] }
  | { type: "flow"; caption: string; steps: { title: string; text: string }[] };

export type CategoryId =
  "start" | "sales" | "customers" | "service" | "catalog" | "planning" | "team" | "fix" | "process";

export type Category = { id: CategoryId; title: string; blurb: string };

export type Article = {
  slug: string;
  title: string;
  /** One sentence: what this page helps with. Shown in lists and search results. */
  summary: string;
  category: CategoryId;
  /** Who can do this, in plain words, when it isn't everyone. */
  who?: string;
  body: Block[];
  /** Slugs of articles worth reading next. */
  related?: string[];
};

// Short constructors keep the content files readable.
export const h = (text: string): Block => ({ type: "h", text });
export const p = (text: string): Block => ({ type: "p", text });
export const steps = (...items: string[]): Block => ({ type: "steps", items });
export const list = (...items: string[]): Block => ({ type: "list", items });
export const tip = (text: string): Block => ({ type: "tip", text });
export const note = (text: string): Block => ({ type: "note", text });
export const warning = (text: string): Block => ({ type: "warning", text });
export const table = (caption: string, head: string[], rows: string[][]): Block => ({
  type: "table",
  caption,
  head,
  rows,
});
export const flow = (caption: string, ...s: { title: string; text: string }[]): Block => ({
  type: "flow",
  caption,
  steps: s,
});
