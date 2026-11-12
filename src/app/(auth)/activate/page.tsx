import type { Metadata } from "next";
import { ActivateForm } from "../auth-forms";

export const metadata: Metadata = { title: "Activate your license" };

export default function ActivatePage() {
  return (
    <>
      <h1>Set up your business</h1>
      <p>Enter the license key from your purchase email, then create your owner account.</p>
      <ActivateForm />
      <p>
        Already activated? <a href="/login">Sign in</a>
      </p>
    </>
  );
}
