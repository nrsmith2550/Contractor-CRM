import Image from "next/image";
import Link from "next/link";
import { ARTICLES } from "@/help";
import { PLANS, SHARED_CONTENT, USERS_INCLUDED } from "@/lib/plans";
import { SLA_HOURS } from "@/server/domain/sla";
import { DEFAULT_ROLES } from "@/server/security/roles";
import { Brand } from "@/components/shell/Brand";
import { PlanCards } from "./PlanCards";

const GOALS = [
  {
    title: "Know where every customer stands",
    text: "Prospects, deals and a pipeline you can read at a glance, with every note, call and task on one timeline.",
  },
  {
    title: "Never miss a follow-up or a due time",
    text: `Tasks with due dates and an overdue flag. Every support request gets a due time from its priority: ${SLA_HOURS.urgent} hours for urgent, ${SLA_HOURS.high} for high, ${SLA_HOURS.normal} for normal and ${SLA_HOURS.low} for low.`,
  },
  {
    title: "Quote fast and look professional",
    text: "Build a quote from your products with tax and discounts, send it as a PDF by email, and turn the win into an order in one click.",
  },
  {
    title: "Keep the crew on schedule",
    text: "A schedule board by team member, with warnings for clashes, and a phone view so the person on site can start, finish and get a signature.",
  },
];

const BENEFITS = [
  {
    title: "Plain words",
    text: "Prospects, customers, deals and jobs. No jargon to learn before you can use it.",
  },
  {
    title: "Everything is linked",
    text: "Click from a customer to their jobs, orders and visits, and back again. Nothing lives in a silo.",
  },
  {
    title: "Easy to start",
    text: `New records start short, a checklist walks you through your first steps, and a built-in guide of ${ARTICLES.length} plain-language articles answers the rest.`,
  },
  {
    title: "Works on a phone",
    text: "Technicians see their day, set off, start and finish visits and capture a customer signature from a phone.",
  },
  {
    title: "Your data stays yours",
    text: "Import your prospects from a spreadsheet and export any list to Excel or CSV whenever you like.",
  },
  {
    title: "Safe by design",
    text: `Each business is kept completely separate. ${DEFAULT_ROLES.length} standard roles decide who can see and change what, and every change is recorded.`,
  },
];

const DEALS_DETAIL = [
  "Prospects with status and rating, and an import from a spreadsheet",
  "Turn a prospect into a customer, person and deal in one step, with a warning about likely duplicates",
  "A deal pipeline through four stages, with a board you can move deals across",
  "Quotes with line items, tax, discounts and freight, as a PDF or by email",
  "Revise a quote and keep every version; win it to create the order",
];
const JOBS_DETAIL = [
  "Support requests with a due time and a colour-coded countdown",
  "Turn a request into a job, with parts and labour recorded against it",
  "A schedule board by team member, filtered by skill, with clash warnings",
  "A phone view for technicians: set off, start, finish, notes and a customer signature",
  "Jobs move through clear steps from unscheduled to posted",
];

const JOURNEY = [
  ["Prospect", "Someone who might buy. Log them and make contact."],
  ["Customer and person", "When they are serious, turn them into a customer in one step."],
  ["Deal", "What you are trying to sell, with a stage and an expected value."],
  ["Quote", "A priced offer you can send as a PDF."],
  ["Order", "Created when the quote is won."],
  ["Job", "The work you will do, from an order or a support request."],
  ["Visit", "A team member booked on the schedule to do the work."],
];

const FAQ = [
  [
    "What is the difference between the plans?",
    `${PLANS.complete.name} has everything. ${PLANS.deals.name} is the selling side (prospects, deals, quotes and orders). ${PLANS.jobs.name} is the doing-the-work side (support requests, jobs, visits and the schedule). Customers, people, products, pricing, notes, tasks, the calendar and reports are in every plan.`,
  ],
  [
    "How many people can use it?",
    `Every plan includes up to ${USERS_INCLUDED} people signing in. If you need more, ask us.`,
  ],
  [
    "Can I change plan later?",
    "Yes, get in touch. Nothing is deleted when you change plan: if you move up, everything is there; if you move down, the other half is hidden and comes back if you move up again.",
  ],
  [
    "Can I get my data out?",
    "Yes. Any list can be exported to Excel or CSV, and prospects can be imported from a spreadsheet.",
  ],
  [
    "Does it work on a phone?",
    "Yes. It runs in any modern browser, and the technician view is built for a phone.",
  ],
  [
    "Who can see what?",
    "Each person has a role. For example, a salesperson sees their own deals, a manager sees everyone's, and a field technician sees only their own visits.",
  ],
  [
    "Do I need to install anything?",
    "No. Clinch runs in your browser, so there is nothing to install or keep up to date.",
  ],
];

const SHOTS = [
  {
    src: "/marketing/pipeline.jpg",
    alt: "The deal pipeline: four columns from Qualify to Close, each with the deals in it and their value.",
    title: "See your whole pipeline",
    text: "Every open deal in its stage, with the value of each stage added up.",
  },
  {
    src: "/marketing/quote.jpg",
    alt: "A draft quote with its customer, person and deal shown as links under Related records, above the quote's line items.",
    title: "Click through linked records",
    text: "A quote links to its customer, person and deal, so you are always one click from the rest of the story.",
  },
  {
    src: "/marketing/requests.jpg",
    alt: "A list of support requests, each with a colour-coded countdown showing how long is left to respond.",
    title: "Never miss a due time",
    text: "Each support request counts down to its due time, and turns red when it is overdue.",
  },
];

/** The public marketing page: what Clinch is for, what it does, and what it costs. */
export function Landing({ support }: { support: string | undefined }) {
  return (
    <div className="mk">
      <a href="#main" className="mk-skip">
        Skip to main content
      </a>
      <header className="mk-header">
        <div className="mk-wrap mk-header-row">
          <Link href="/" className="mk-logo" aria-label="Clinch CRM home">
            <Brand alt="" />
          </Link>
          <nav aria-label="Main" className="mk-nav">
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <Link href="/login" className="mk-btn mk-btn-small">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="mk-hero" aria-labelledby="hero-title">
          <div className="mk-wrap mk-hero-grid">
            <div>
              <p className="mk-eyebrow">Clinch CRM</p>
              <h1 id="hero-title">Win the work. Run the work.</h1>
              <p className="mk-lede">
                A plain-language CRM for small businesses, contractors, sole proprietors and small
                brands. Keep every prospect, customer, quote and job in one place, without the
                jargon.
              </p>
              <p className="mk-actions">
                <a className="mk-btn mk-btn-primary" href="#pricing">
                  See pricing
                </a>
                <a className="mk-btn" href="#features">
                  See what it does
                </a>
              </p>
            </div>
            <Image
              className="mk-shot mk-hero-shot"
              src="/marketing/home.jpg"
              alt="The Clinch home screen: counts of open prospects, deals, pipeline value, support requests and jobs, with your open tasks and anything past due."
              width={1280}
              height={800}
              priority
              unoptimized
            />
          </div>
        </section>

        <section className="mk-section" aria-labelledby="goals-title">
          <div className="mk-wrap">
            <h2 id="goals-title">Built for the person running the business</h2>
            <p className="mk-sub">
              You are busy doing the work. Clinch is built around four things that matter.
            </p>
            <ul className="mk-cards">
              {GOALS.map((g) => (
                <li key={g.title} className="mk-card">
                  <h3>{g.title}</h3>
                  <p>{g.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mk-section mk-alt" aria-labelledby="benefits-title">
          <div className="mk-wrap">
            <h2 id="benefits-title">Why small businesses choose it</h2>
            <ul className="mk-cards mk-cards-3">
              {BENEFITS.map((b) => (
                <li key={b.title} className="mk-card">
                  <h3>{b.title}</h3>
                  <p>{b.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="features" className="mk-section" aria-labelledby="features-title">
          <div className="mk-wrap">
            <h2 id="features-title">What it does</h2>
            <p className="mk-sub">
              Two halves that work together, on top of everything you share. Buy the whole thing, or
              just the half you need.
            </p>
            <div className="mk-cols">
              <div className="mk-col">
                <h3>{PLANS.deals.name}</h3>
                <p className="mk-muted">The selling side.</p>
                <ul className="mk-checks">
                  {DEALS_DETAIL.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
              <div className="mk-col">
                <h3>{PLANS.jobs.name}</h3>
                <p className="mk-muted">The doing-the-work side.</p>
                <ul className="mk-checks">
                  {JOBS_DETAIL.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
              <div className="mk-col">
                <h3>In every plan</h3>
                <p className="mk-muted">Shared by both halves.</p>
                <ul className="mk-checks">
                  {SHARED_CONTENT.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="mk-section mk-alt" aria-labelledby="shots-title">
          <div className="mk-wrap">
            <h2 id="shots-title">See it in action</h2>
            <p className="mk-sub">
              Real screens from a demonstration business. The names and numbers are made up.
            </p>
            <div className="mk-shots">
              {SHOTS.map((s) => (
                <figure key={s.src} className="mk-figure">
                  <Image
                    className="mk-shot"
                    src={s.src}
                    alt={s.alt}
                    width={1280}
                    height={800}
                    unoptimized
                  />
                  <figcaption>
                    <strong>{s.title}.</strong> {s.text}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="mk-section" aria-labelledby="journey-title">
          <div className="mk-wrap">
            <h2 id="journey-title">From first enquiry to finished work</h2>
            <p className="mk-sub">
              One journey, start to finish. Stop wherever your business stops.
            </p>
            <ol className="mk-journey">
              {JOURNEY.map(([title, text]) => (
                <li key={title}>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="pricing" className="mk-section mk-alt" aria-labelledby="pricing-title">
          <div className="mk-wrap">
            <h2 id="pricing-title">Simple pricing</h2>
            <p className="mk-sub">
              A one-time setup fee, then one flat monthly price for your whole team: up to{" "}
              {USERS_INCLUDED} people. Choose the whole suite, or just the half you need.
            </p>
            <PlanCards support={support} />
          </div>
        </section>

        <section id="faq" className="mk-section" aria-labelledby="faq-title">
          <div className="mk-wrap mk-narrow">
            <h2 id="faq-title">Questions</h2>
            <div className="mk-faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="mk-section mk-cta" aria-labelledby="cta-title">
          <div className="mk-wrap mk-narrow">
            <h2 id="cta-title">Ready to get started?</h2>
            <p className="mk-sub">
              Get in touch and we will set up your business and send you your licence key.
            </p>
            <p className="mk-actions">
              {support ? (
                <a
                  className="mk-btn mk-btn-primary"
                  href={`mailto:${support}?subject=${encodeURIComponent("Clinch CRM enquiry")}`}
                >
                  Get in touch
                </a>
              ) : null}
              <Link className="mk-btn" href="/activate">
                I have a licence key
              </Link>
              <Link className="mk-btn" href="/login">
                Sign in
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-row">
          <p>© Clinch CRM</p>
          <nav aria-label="Footer">
            <a href="#pricing">Pricing</a>
            <Link href="/login">Sign in</Link>
            <Link href="/activate">Activate a licence</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
