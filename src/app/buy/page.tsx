import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/shell/Brand";
import { MAX_SELF_SERVE_USERS, USERS_INCLUDED, isEdition } from "@/lib/plans";
import { isStripeConfigured, stripeMode } from "@/server/billing/stripe";
import "../crm.css";
import "../marketing.css";
import { BuyFlow } from "./BuyFlow";

export const metadata: Metadata = {
  title: "Buy Gantry CRM",
  description: "Choose a plan and pay securely, right here. Your licence key arrives by email.",
};

// Keys and the support address come from the environment, so read them when requested.
export const dynamic = "force-dynamic";

/** Choose a plan and pay without leaving Gantry. The form itself is Stripe's, drawn in this page. */
export default async function BuyPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; people?: string }>;
}) {
  const sp = await searchParams;
  const edition = isEdition(sp.plan) ? sp.plan : "complete";
  const n = Number(sp.people);
  const people =
    Number.isInteger(n) && n >= USERS_INCLUDED && n <= MAX_SELF_SERVE_USERS ? n : USERS_INCLUDED;
  const configured = isStripeConfigured();

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
      <main id="main" className="mk-wrap mk-buy">
        <h1>Buy Gantry CRM</h1>
        <p className="mk-muted">
          Pick your plan and pay securely on this page. Your licence key is emailed to you as soon
          as the payment goes through.
        </p>
        <BuyFlow
          publishableKey={configured ? (process.env.STRIPE_PUBLISHABLE_KEY ?? null) : null}
          testMode={configured && stripeMode() === "test"}
          support={process.env.SUPPORT_EMAIL}
          initialEdition={edition}
          initialPeople={people}
        />
      </main>
    </div>
  );
}
