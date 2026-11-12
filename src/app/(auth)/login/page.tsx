import type { Metadata } from "next";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ hint?: string; next?: string; reason?: string }>;
}) {
  const { hint, next, reason } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {hint ? (
        <p>
          This license has already been activated. Sign in as <strong>{hint}</strong>.
        </p>
      ) : null}
      <LoginForm next={next} reason={reason} />
      <p>
        New here? <a href="/activate">Activate a license</a>
      </p>
    </>
  );
}
