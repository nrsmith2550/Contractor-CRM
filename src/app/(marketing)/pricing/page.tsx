import type { Metadata } from "next";
import { PricingCards } from "./pricing-cards";

export const metadata: Metadata = { title: "Pricing" };

const MESSAGES: Record<string, string> = {
  invalid: "That plan isn't available. Please choose one below.",
  unavailable: "Checkout isn't available right now. Please try again shortly.",
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 16px" }}>
      <h1>Pricing</h1>
      <p>
        Pay once, own your license. Priced by the number of active users; every plan includes Sales,
        Quotes, Service and the Schedule Board.
      </p>
      {error && MESSAGES[error] ? <p role="alert">{MESSAGES[error]}</p> : null}
      <PricingCards />
    </main>
  );
}
