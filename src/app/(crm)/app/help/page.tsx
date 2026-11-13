import type { Metadata } from "next";
import Link from "next/link";
import {
  ARTICLES,
  CATEGORIES,
  POPULAR,
  articleBySlug,
  articlesIn,
  categoryOf,
  search,
} from "@/help";

export const metadata: Metadata = { title: "Help guide" };

export default async function HelpHome({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const results = q ? search(q) : [];
  const support = process.env.SUPPORT_EMAIL;

  return (
    <div className="help">
      <h1>Help guide</h1>
      <p className="help-lede">
        Plain answers on how to do things, how the pieces fit together, and what to do when
        something is not working.
      </p>

      <form method="get" className="help-search">
        <label htmlFor="help-q">Search the help guide</label>
        <div className="crm-row">
          <input
            id="help-q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder='For example "send a quote"'
          />
          <button className="crm-btn crm-btn-primary" type="submit">
            Search
          </button>
        </div>
      </form>

      {q ? (
        <section aria-label="Search results">
          <h2>
            {results.length} {results.length === 1 ? "result" : "results"} for &ldquo;{q}&rdquo;
          </h2>
          {results.length === 0 ? (
            <p>
              Nothing matched. Try fewer or simpler words, or{" "}
              <Link href="/app/help">browse by topic</Link>.
            </p>
          ) : (
            <ul className="help-results">
              {results.map((a) => (
                <li key={a.slug}>
                  <Link href={`/app/help/${a.slug}`}>{a.title}</Link>
                  <span className="crm-muted"> · {categoryOf(a).title}</span>
                  <div>{a.summary}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <section aria-label="Start here">
            <h2>Start here</h2>
            <ul className="help-popular">
              {POPULAR.map((slug) => {
                const a = articleBySlug(slug)!;
                return (
                  <li key={slug}>
                    <Link href={`/app/help/${a.slug}`}>{a.title}</Link>
                    <div className="crm-muted">{a.summary}</div>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="help-grid">
            {CATEGORIES.map((c) => (
              <section key={c.id} className="help-cat" aria-labelledby={`cat-${c.id}`}>
                <h2 id={`cat-${c.id}`}>{c.title}</h2>
                <p className="crm-muted">{c.blurb}</p>
                <ul>
                  {articlesIn(c.id).map((a) => (
                    <li key={a.slug}>
                      <Link href={`/app/help/${a.slug}`}>{a.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <section className="help-contact" aria-label="Still need help">
        <h2>Still need help?</h2>
        <p>
          {support ? (
            <>
              Email <a href={`mailto:${support}`}>{support}</a> and tell us what you were trying to
              do and what you saw.
            </>
          ) : (
            <>
              Ask the person who set up Clinch CRM for your business (your administrator), and tell
              them what you were trying to do and what you saw.
            </>
          )}{" "}
          There are {ARTICLES.length} guides here.
        </p>
      </section>
    </div>
  );
}
