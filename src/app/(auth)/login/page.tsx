import type { Metadata } from "next";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ hint?: string; next?: string; reason?: string; reset?: string }>;
}) {
  const { hint, next, reason, reset } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {reset ? <p role="status">Your password was changed. Sign in with the new one.</p> : null}
      {hint ? (
        <p>
          This license has already been activated. Sign in as <strong>{hint}</strong>.
        </p>
      ) : null}
      <LoginForm next={next} reason={reason} />
      <p>
        <a href="/forgot-password">Forgot your password?</a>
      </p>
      <p>
        New here? <a href="/activate">Activate a license</a>
      </p>
    </>
  );
}
