import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/shell/Brand";
import { LEGAL } from "@/lib/legal";
import "../crm.css";
import "../marketing.css";
import { ConsultationForm } from "./ConsultationForm";

export const metadata: Metadata = {
  title: "Book a consultation",
  description:
    "Ask for a free 30-minute consultation. Tell us about your business and when to call, and we will phone you to agree a time.",
};

export default function ConsultationPage() {
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

      <main id="main" className="mk-wrap mk-narrow mk-consult">
        <h1>Book a consultation</h1>
        <p className="mk-lede">
          A free 30-minute call about your business and how Gantry CRM could fit. Tell us a little
          about you below. We will phone you, usually within two business days, and agree a time
          together.
        </p>
        <p className="mk-muted">Calls are on weekday evenings and Saturdays.</p>
        <ConsultationForm supportEmail={LEGAL.email} />
      </main>

      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-row">
          <p>© Gantry CRM</p>
          <nav aria-label="Footer">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
            <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
