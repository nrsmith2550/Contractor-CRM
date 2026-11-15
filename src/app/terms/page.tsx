import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/LegalPage";
import { LEGAL } from "@/lib/legal";
import "../crm.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Gantry CRM: plans, payment, cancelling, refunds and your data.",
};

const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;

const SECTIONS: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <>
        <p>
          These terms are an agreement between you and {LEGAL.seller} (&ldquo;Gantry&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;), based in {LEGAL.place}. By buying Gantry CRM,
          activating a licence key or using the service, you agree to them.
        </p>
        <p>
          If you accept for a business, you confirm you have the authority to bind it, and
          &ldquo;you&rdquo; means that business.
        </p>
      </>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <>
        <p>
          Gantry CRM is hosted software for managing prospects, customers, quotes, orders, support
          requests, jobs and scheduling. The parts you can use depend on your plan: Gantry Complete,
          Gantry Deals or Gantry Jobs.
        </p>
        <p>
          We keep improving the service, so features can change. We will not remove a feature you
          pay for without telling you first and offering a fair alternative.
        </p>
      </>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and licence keys",
    body: (
      <>
        <p>
          After you buy, we email a licence key to the address you gave at checkout. The key
          activates once, to create your business and its owner account. Keep the key and your
          passwords safe: you are responsible for what happens under your account.
        </p>
        <ul>
          <li>
            A licence covers one business and the number of people your plan includes, plus any
            extra people you pay for.
          </li>
          <li>
            Do not share keys or sign-ins with people outside your business, or resell the service.
          </li>
          <li>Keep your contact details up to date so we can reach you about your account.</li>
        </ul>
      </>
    ),
  },
  {
    id: "payment",
    title: "Plans, prices and payment",
    body: (
      <>
        <p>
          Prices are shown on our pricing section and at checkout, in US dollars. You pay a one-time
          setup fee and then a monthly fee, plus a monthly fee for each extra person beyond those
          your plan includes. Card payments are handled by Stripe. Your plan renews every month
          until you cancel.
        </p>
        <ul>
          <li>
            If you change your plan or the number of people, we charge or credit the difference for
            the rest of the current month. Moving to a plan with a higher setup fee charges the
            difference in setup fee, once.
          </li>
          <li>Prices do not include taxes. Where the law requires, we add them.</li>
          <li>
            We may change prices. We will give you at least {LEGAL.noticeDays} days&rsquo; notice by
            email, and the new price applies from your next renewal after that.
          </li>
          <li>
            If a payment fails, we may mark your account overdue and ask you to update your card. If
            it is still not resolved, we may suspend access until it is.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "cancel",
    title: "Cancelling and refunds",
    body: (
      <>
        <p>
          You can cancel any time from Settings, then Billing, inside Gantry. Cancelling stops the
          next renewal, and you keep access until the end of the period you have paid for.
        </p>
        <p>
          <strong>{LEGAL.refundDays}-day money-back guarantee.</strong> If you ask us within{" "}
          {LEGAL.refundDays} days of your first purchase, we will refund the setup fee and your
          first monthly payment, in the amount you actually paid (including after any promotion
          code), to the card you paid with, and end your access. Email us at {mail}. Refunds usually
          appear within 5 to 10 business days, depending on your card issuer.
        </p>
        <p>
          After those {LEGAL.refundDays} days, payments are not refundable, including the setup fee
          and any month already started, except where the law requires otherwise.
        </p>
      </>
    ),
  },
  {
    id: "data",
    title: "Your data",
    body: (
      <>
        <p>
          You own the information you put into Gantry (&ldquo;Your Data&rdquo;). We use it only to
          provide the service. You give us permission to store, copy, back up and display it as
          needed to run the service for you.
        </p>
        <ul>
          <li>You can export your lists to Excel or CSV at any time.</li>
          <li>
            You are responsible for having the right to enter your customers&rsquo; details, and for
            how you use Gantry, including the quotes you email.
          </li>
          <li>
            If your account ends and you want your data deleted, tell us at {mail} and we will
            delete it within {LEGAL.deleteDays} days of your request, apart from records we must
            keep by law.
          </li>
        </ul>
        <p>
          How we handle personal information is described in our{" "}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>use Gantry for anything unlawful, harmful or abusive;</li>
          <li>try to break, overload or get around the security of the service;</li>
          <li>use the quote emails to send spam or anything misleading;</li>
          <li>upload malicious files, or data you have no right to hold.</li>
        </ul>
      </>
    ),
  },
  {
    id: "support",
    title: "Support and availability",
    body: (
      <p>
        We give support by email at {mail}, and aim to reply within two business days. We work to
        keep Gantry running, but we cannot promise it will always be available or error-free. There
        may be maintenance or outages. Please export anything important from time to time.
      </p>
    ),
  },
  {
    id: "suspension",
    title: "Suspension and ending",
    body: (
      <p>
        We may suspend or end your access if you break these terms, if a payment is not resolved, or
        if we need to for security or legal reasons. Where we can, we will tell you first. You can
        end the agreement at any time by cancelling.
      </p>
    ),
  },
  {
    id: "disclaimer",
    title: "No warranty",
    body: (
      <p>
        Gantry is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We do not give any
        warranty beyond what the law requires. Gantry is a tool: it is not legal, tax or accounting
        advice, and you should check quotes, totals and tax amounts before you rely on them.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limit of liability",
    body: (
      <>
        <p>
          To the fullest extent the law allows, we are not liable for indirect or consequential
          losses, or for lost profits, revenue or data. Our total liability for any claim is limited
          to the amount you paid us in the 12 months before the claim arose.
        </p>
        <p>Nothing in these terms limits liability that the law does not allow us to limit.</p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms. For changes that matter, we will tell you by email or when you
        sign in at least {LEGAL.noticeDays} days before they take effect. If you keep using Gantry
        after that, you accept the new terms.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of {LEGAL.law}, without regard to its conflict-of-laws
        rules. Any dispute will be brought in the courts of {LEGAL.county}.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        {LEGAL.seller}, {LEGAL.place}. Email: {mail}.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={
        <p>
          Please read these terms carefully. They explain how Gantry CRM works, what you pay, how to
          cancel and get a refund, and what each of us is responsible for.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
