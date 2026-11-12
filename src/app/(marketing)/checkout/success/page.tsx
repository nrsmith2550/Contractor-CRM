import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment received" };

// Deliberately generic: the license key is only ever delivered by email, never shown on this
// page or reachable from the session id in the URL.
export default function CheckoutSuccessPage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 16px" }}>
      <h1>Thank you — payment received</h1>
      <p>
        We&apos;ve emailed your license key to the address you used at checkout. It usually arrives
        within a minute. Check your spam folder if you don&apos;t see it.
      </p>
      <p>
        When it arrives, open <a href="/activate">the activation page</a> and enter the key to
        create your business and your sign-in.
      </p>
    </main>
  );
}
