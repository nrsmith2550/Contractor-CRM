import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpBlocks } from "@/components/help/HelpBlocks";
import { articleBySlug, articlesIn, categoryOf } from "@/help";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const a = articleBySlug((await params).slug);
  return { title: a ? a.title : "Help guide" };
}

export default async function HelpArticle({ params }: { params: Promise<{ slug: string }> }) {
  const a = articleBySlug((await params).slug);
  if (!a) notFound();
  const cat = categoryOf(a);
  const siblings = articlesIn(a.category);
  const i = siblings.findIndex((s) => s.slug === a.slug);
  const prev = siblings[i - 1];
  const next = siblings[i + 1];
  const related = (a.related ?? []).map((s) => articleBySlug(s)).filter((x) => !!x);

  return (
    <article className="help help-article">
      <nav aria-label="Breadcrumb" className="help-crumbs">
        <Link href="/app/help">Help guide</Link> <span aria-hidden="true">›</span> {cat.title}
      </nav>
      <h1>{a.title}</h1>
      <p className="help-lede">{a.summary}</p>
      {a.who && (
        <p className="help-who">
          <strong>Who can do this:</strong> {a.who}
        </p>
      )}

      <HelpBlocks blocks={a.body} />

      {related.length > 0 && (
        <section aria-label="Related guides" className="help-related">
          <h2>Related guides</h2>
          <ul>
            {related.map((r) => (
              <li key={r!.slug}>
                <Link href={`/app/help/${r!.slug}`}>{r!.title}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav aria-label="More in this topic" className="help-pager">
        {prev ? <Link href={`/app/help/${prev.slug}`}>← {prev.title}</Link> : <span />}
        {next ? <Link href={`/app/help/${next.slug}`}>{next.title} →</Link> : <span />}
      </nav>
    </article>
  );
}
