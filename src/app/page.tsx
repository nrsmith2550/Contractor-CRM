import type { Metadata } from "next";
import { Landing } from "@/components/marketing/Landing";
import "./crm.css";
import "./marketing.css";

export const metadata: Metadata = {
  title: { absolute: "Gantry CRM: win the work, run the work" },
  description:
    "A plain-language CRM for small businesses, contractors, sole proprietors and small brands: prospects, deals, quotes, support requests, jobs and a schedule in one place.",
};

// The support address comes from the environment, so it is read when the page is requested.
export const dynamic = "force-dynamic";

export default function Home() {
  return <Landing support={process.env.SUPPORT_EMAIL} />;
}
