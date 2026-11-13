import Link from "next/link";
import { Brand } from "@/components/shell/Brand";
import "./crm.css";

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 560 }}>
      <div className="public-brand" style={{ justifyContent: "flex-start" }}>
        <Brand />
      </div>
      <h1 className="crm-sr">Clinch CRM</h1>
      <p>Customer relationship management for your business.</p>
      <p style={{ display: "flex", gap: 16 }}>
        <Link href="/login">Sign in</Link>
        <Link href="/activate">Activate a license</Link>
        <Link href="/pricing">Pricing</Link>
      </p>
    </main>
  );
}
