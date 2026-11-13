"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeActivityAction } from "@/server/actions/activities";

/** "Mark done" for an open task or call on a timeline. */
export function DoneButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <button
        type="button"
        className="crm-btn"
        disabled={pending}
        aria-label={`Mark done: ${label}`}
        onClick={() =>
          start(async () => {
            const r = await completeActivityAction(id);
            if (r.ok) router.refresh();
            else setErr(r.message);
          })
        }
      >
        Mark done
      </button>
      {err && (
        <span role="alert" className="crm-error">
          {err}
        </span>
      )}
    </>
  );
}
