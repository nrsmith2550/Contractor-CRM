import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "@/components/shell/Brand";
import { LEGAL } from "@/lib/legal";

/** A numbered section of a legal page. */
export type LegalSection = { id: string; title: string; body: ReactNode };

/** The shared layout for the Terms and the Privacy Policy: a plain page with a contents list. */
export function LegalPage({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
}) {
  return (
    <div className="mk">
      <a href="#main" className="mk-skip">
        Skip to main content
      </a>
      <header className="mk-header">
        <div className="mk-wrap mk-header-row">
          <Link href="/" className="mk-logo" aria-label="Gantry CRM home">
            <Brand alt="" />
          </Link>
          <nav aria-label="Main" className="mk-nav">
            <Link href="/#pricing">Pricing</Link>
            <Link href="/login" className="mk-btn mk-btn-small">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="mk-wrap mk-narrow mk-legal">
        <h1>{title}</h1>
        <p className="mk-muted">Last updated {LEGAL.updated}</p>
        {intro}

        <nav aria-label="Contents" className="mk-legal-toc">
          <h2>Contents</h2>
          <ol>
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>
              {i + 1}. {s.title}
            </h2>
            {s.body}
          </section>
        ))}
      </main>

      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-row">
          <p>© Gantry CRM</p>
          <nav aria-label="Footer">
            <Link href="/terms">Terms of Service</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
