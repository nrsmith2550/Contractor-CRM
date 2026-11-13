import { describe, expect, it } from "vitest";
import {
  ARTICLES,
  CATEGORIES,
  HELP_FOR_ENTITY,
  POPULAR,
  articleBySlug,
  articlesIn,
  search,
} from "@/help";
import { accessWord } from "@/help/content/process";
import { articleText, blockText, searchArticles } from "@/help/search";
import type { Article } from "@/help/types";
import { SLA_HOURS } from "@/server/domain/sla";
import { MAX_IMPORT_ROWS } from "@/server/domain/lead-import";
import { DEFAULT_ROLES } from "@/server/security/roles";
import { ENTITIES } from "@/entities";

const textOf = (a: Article) => `${a.title} ${a.summary} ${a.who ?? ""} ${articleText(a)}`;
const links = (a: Article): string[] => {
  const out: string[] = [];
  const re = /\]\(([^)\s]+)\)/g;
  for (const b of a.body) {
    let m: RegExpExecArray | null;
    const t = JSON.stringify(b);
    while ((m = re.exec(t))) out.push(m[1]!);
  }
  return out;
};

describe("the help guide's structure", () => {
  it("has unique slugs and every article in a real category", () => {
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const a of ARTICLES) expect(cats.has(a.category), a.slug).toBe(true);
    for (const c of CATEGORIES) expect(articlesIn(c.id).length, c.id).toBeGreaterThan(0);
  });

  it("has a title, a short summary and real content on every article", () => {
    for (const a of ARTICLES) {
      expect(a.title.length, a.slug).toBeGreaterThan(3);
      expect(a.title.length, `${a.slug} title`).toBeLessThanOrEqual(80);
      expect(a.summary.length, `${a.slug} summary`).toBeGreaterThan(20);
      expect(a.summary.length, `${a.slug} summary`).toBeLessThanOrEqual(150);
      expect(articleText(a).length, `${a.slug} body`).toBeGreaterThan(150);
    }
  });

  it("only links to things that exist", () => {
    const ROUTE =
      /^\/app(\/(prospects(\/import)?|customers|people|deals|products|support-requests|jobs|team|my-visits|pricing|quotes(\/new)?|orders|pipeline|calendar|schedule|dashboards\/(sales|service)|settings\/(users|tax-rates|branding|service)|help))?$/;
    for (const a of ARTICLES) {
      for (const href of links(a)) {
        const help = /^\/app\/help\/([a-z0-9-]+)$/.exec(href);
        if (help) expect(articleBySlug(help[1]!), `${a.slug} -> ${href}`).toBeTruthy();
        else expect(ROUTE.test(href), `${a.slug} links to unknown ${href}`).toBe(true);
      }
      for (const r of a.related ?? [])
        expect(articleBySlug(r), `${a.slug} related ${r}`).toBeTruthy();
    }
    for (const s of POPULAR) expect(articleBySlug(s), `popular ${s}`).toBeTruthy();
    for (const s of Object.values(HELP_FOR_ENTITY))
      expect(articleBySlug(s), `entity help ${s}`).toBeTruthy();
    for (const key of Object.keys(HELP_FOR_ENTITY)) expect(key in ENTITIES).toBe(true);
  });

  it("uses the plain names, never the old ones (except in the page that explains them)", () => {
    const OLD =
      /\b(leads?|accounts?|opportunit(y|ies)|work orders?|cases?|bookings?|resources?|qualif(?!y\b)\w*|price lists?|business process flow)\b/i;
    const offenders = ARTICLES.filter((a) => a.slug !== "words-we-use")
      .map((a) => [a.slug, OLD.exec(textOf(a))?.[0]] as const)
      .filter(([, hit]) => hit);
    expect(offenders).toEqual([]);
  });

  it("has a caption on every table and a name on every flow", () => {
    for (const a of ARTICLES) {
      for (const b of a.body) {
        if (b.type === "table") {
          expect(b.caption.length, `${a.slug} table caption`).toBeGreaterThan(3);
          for (const r of b.rows) expect(r.length, `${a.slug} row width`).toBe(b.head.length);
        }
        if (b.type === "flow") expect(b.steps.length, `${a.slug} flow`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("the guide quotes the product's real numbers", () => {
  it("due times match the rules the app enforces", () => {
    const dueTimes = articleBySlug("due-times")!;
    const t = dueTimes.body.find((b) => b.type === "table")!;
    if (t.type !== "table") throw new Error("expected a table");
    const rows = Object.fromEntries(t.rows.map((r) => [r[0]!.toLowerCase(), r[1]]));
    for (const [priority, hours] of Object.entries(SLA_HOURS))
      expect(rows[priority]).toBe(`${hours} hours`);
  });

  it("the import limit is the real one", () => {
    expect(articleText(articleBySlug("import")!)).toContain(
      MAX_IMPORT_ROWS.toLocaleString("en-US"),
    );
  });

  it("the who-can-do-what table agrees with the real role settings", () => {
    const a = articleBySlug("who-can-do-what")!;
    const t = a.body.find((b) => b.type === "table")!;
    if (t.type !== "table") throw new Error("expected a table");
    const col = (role: string) => t.head.indexOf(role);
    const row = (area: string) => t.rows.find((r) => r[0] === area)!;
    expect(t.head.slice(1)).toEqual(DEFAULT_ROLES.map((r) => r.name));
    expect(row("Prospects")[col("Salesperson")]).toBe("Own only");
    expect(row("Prospects")[col("Sales Manager")]).toBe("Full");
    expect(row("Customers")[col("Salesperson")]).toBe("Full");
    expect(row("Customers")[col("Field Technician")]).toBe("View all");
    expect(row("Jobs")[col("Customer Service Rep")]).toBe("Full");
    expect(row("Jobs")[col("Field Technician")]).toBe("View all");
    expect(row("Visits")[col("Field Technician")]).toBe("Own only");
    expect(row("Products and services")[col("Customer Service Rep")]).toBe("No access");
    expect(row("Users")[col("System Administrator")]).toBe("Full");
    for (const r of t.rows)
      expect(r[col("Read-only")] === "View all" || r[col("Read-only")] === "No access", r[0]).toBe(
        true,
      );
    for (const r of t.rows) expect(r[col("System Administrator")]).toBe("Full");
  });

  it("describes access in plain words", () => {
    expect(accessWord(undefined)).toBe("No access");
    expect(accessWord({ read: "user", write: "user" })).toBe("Own only");
    expect(accessWord({ read: "user" })).toBe("View own");
    expect(accessWord({ read: "organization" })).toBe("View all");
    expect(accessWord({ read: "organization", write: "user" })).toBe("View all, change own");
    expect(accessWord({ read: "organization", write: "organization" })).toBe("Full");
  });
});

describe("searching the guide", () => {
  const top = (q: string) => search(q)[0]?.slug;
  it("finds what people would type", () => {
    expect(top("send a quote")).toBe("quotes");
    expect(top("forgot password")).toBeTruthy();
    expect(search("forgot password").map((a) => a.slug)).toContain("signing-in");
    expect(search("signature").map((a) => a.slug)).toContain("technician-visits");
    expect(search("export excel").map((a) => a.slug)).toContain("export");
    expect(search("seats").map((a) => a.slug)).toContain("seats-license");
  });
  it("needs every word, so extra words narrow it", () => {
    const wide = search("quote").length;
    const narrow = search("quote revise").length;
    expect(narrow).toBeGreaterThan(0);
    expect(narrow).toBeLessThanOrEqual(wide);
    expect(search("quote zzzzqqq")).toEqual([]);
  });
  it("ranks a title match above a body match", () => {
    const r = search("calendar");
    expect(r[0]!.slug).toBe("calendar");
  });
  it("is safe with odd input", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
    expect(search("!!! ???")).toEqual([]);
    expect(search("a".repeat(5000))).toEqual([]);
    expect(() => search("<script>alert(1)</script>")).not.toThrow();
    expect(searchArticles([], "x")).toEqual([]);
  });
  it("searches the words people read, not the markup", () => {
    const a = articleBySlug("first-day")!;
    const plain = blockText(a.body.find((b) => b.type === "steps")!);
    expect(plain).not.toContain("](");
    expect(plain).not.toContain("**");
  });
});

describe("the text format", () => {
  it("shows links, bold and italics, and nothing else, as plain words in search", () => {
    const a: Article = {
      slug: "x",
      title: "T",
      summary: "S",
      category: "start",
      body: [
        {
          type: "p",
          text: "Use **Save** on the *Closed Prospects* view: [see more](/app/help/quotes).",
        },
      ],
    };
    expect(blockText(a.body[0]!)).toBe("Use Save on the Closed Prospects view: see more.");
  });
  it("leaves no stray markup characters anywhere in the guide", () => {
    for (const a of ARTICLES) {
      const text = `${a.title} ${a.summary} ${articleText(a)}`;
      expect(text, a.slug).not.toMatch(/[*]|\]\(/);
    }
  });
});
