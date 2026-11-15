import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/marketing/LegalPage";
import { LEGAL, PROVIDERS } from "@/lib/legal";
import "../crm.css";
import "../marketing.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Gantry CRM collects, why, who helps us run it, and the choices you have.",
};

const mail = <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>;

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <p>
        Gantry CRM is run by {LEGAL.seller}, based in {LEGAL.place}. This policy covers our website
        and the Gantry CRM service.
      </p>
    ),
  },
  {
    id: "roles",
    title: "Two kinds of information",
    body: (
      <>
        <p>
          <strong>About you and your business.</strong> Your account, billing and sign-in details.
          We decide how these are used, as described here.
        </p>
        <p>
          <strong>About your customers.</strong> The prospects, customers, quotes, jobs and notes
          you enter into Gantry. This is Your Data. You decide what goes in and why, and we handle
          it only on your behalf, to run the service. If you are a customer of a business that uses
          Gantry, please contact that business about your information.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <ul>
        <li>
          <strong>Account:</strong> your name, email address and a password. We store only a secure
          hash of the password, never the password itself.
        </li>
        <li>
          <strong>Business:</strong> the company name, time zone, currency and logo you set up, and
          the people you invite.
        </li>
        <li>
          <strong>Billing:</strong> your plan, subscription status, amounts paid and the payment
          provider&rsquo;s reference numbers. Card details go straight to Stripe. We never see or
          store a full card number.
        </li>
        <li>
          <strong>Your Data:</strong> whatever you enter into Gantry about your own prospects and
          customers.
        </li>
        <li>
          <strong>Security and usage:</strong> your IP address, browser, sign-in times, a record of
          changes made in your account, and counters that limit repeated attempts.
        </li>
        <li>
          <strong>Messages:</strong> emails we send you (licence keys, invitations, password resets,
          quotes you send) and anything you write to our support address.
        </li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "How we use it",
    body: (
      <ul>
        <li>to provide, support and secure the service;</li>
        <li>to take payment and send receipts and service emails;</li>
        <li>to answer your questions and fix problems;</li>
        <li>to meet legal, tax and accounting duties.</li>
      </ul>
    ),
  },
  {
    id: "sharing",
    title: "Who we share it with",
    body: (
      <>
        <p>
          We use these companies to run Gantry. They handle information only to do the job we give
          them:
        </p>
        <ul>
          {PROVIDERS.map(([name, job]) => (
            <li key={name}>
              <strong>{name}</strong> {job}.
            </li>
          ))}
        </ul>
        <p>
          We do not sell personal information, and we do not share it for advertising. We may
          disclose information if the law requires it, or to protect people&rsquo;s safety or our
          rights.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We use a cookie to keep you signed in and one to remember your light or dark theme. We do
        not use advertising or tracking cookies. Stripe&rsquo;s payment form sets its own cookies to
        prevent fraud.
      </p>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <p>
        Connections use HTTPS. Passwords are stored as strong hashes, and sign-in and reset tokens
        are stored only as hashes. Each business&rsquo;s data is kept separate from every other
        business&rsquo;s by controls in the database itself. No system is perfectly secure. If a
        breach affects your information, we will tell you as the law requires.
      </p>
    ),
  },
  {
    id: "keeping",
    title: "How long we keep it",
    body: (
      <p>
        We keep account and billing records while your account is active, and afterwards for as long
        as the law requires us to keep financial records. Your Data stays until you ask us to delete
        it (see the Terms), and we delete it within {LEGAL.deleteDays} days of your request.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your choices",
    body: (
      <p>
        You can ask us to show you, correct, export or delete the personal information we hold about
        you. Email {mail}. We will reply within {LEGAL.deleteDays} days. You can also export your
        lists from inside Gantry whenever you like.
      </p>
    ),
  },
  {
    id: "where",
    title: "Where it is kept",
    body: (
      <p>
        Gantry is run from the United States, and the information is stored and processed in the
        United States.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: <p>Gantry is business software and is not meant for anyone under 18.</p>,
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy in a way that matters, we will say so by email or when you sign in,
        and update the date at the top.
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

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains what information Gantry CRM collects, why, who helps us run it, and
          the choices you have.
        </p>
      }
      sections={SECTIONS}
    />
  );
}
