import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 560 }}>
      <h1>Clinch CRM</h1>
      <p>Customer relationship management for your business.</p>
      <p style={{ display: "flex", gap: 16 }}>
        <Link href="/login">Sign in</Link>
        <Link href="/activate">Activate a license</Link>
        <Link href="/pricing">Pricing</Link>
      </p>
    </main>
  );
}
