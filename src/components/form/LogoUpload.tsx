"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveLogoAction } from "@/server/actions/branding";
import type { CmdResult } from "@/server/actions/entities";

const MAX = 200 * 1024;

export function LogoUpload({ current }: { current: string | null }) {
  const router = useRouter();
  const [res, setRes] = useState<CmdResult | null>(null);
  const [pending, start] = useTransition();

  const save = (dataUrl: string | null) =>
    start(async () => {
      const r = await saveLogoAction(dataUrl);
      setRes(r);
      if (r.ok) router.refresh();
    });

  return (
    <div>
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
        <img
          src={current}
          alt="Current company logo"
          style={{ maxHeight: 64, maxWidth: 240, display: "block", marginBottom: 8 }}
        />
      ) : (
        <p>No logo yet. Quote PDFs show the company name only.</p>
      )}
      <label htmlFor="logo-file">Logo (PNG or JPEG, under 200 KB)</label>
      <input
        id="logo-file"
        type="file"
        accept="image/png,image/jpeg"
        disabled={pending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > MAX) {
            setRes({ ok: false, message: "The logo must be under 200 KB." });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => save(String(reader.result));
          reader.readAsDataURL(f);
        }}
      />
      {current && (
        <button className="crm-btn" type="button" disabled={pending} onClick={() => save(null)}>
          Remove logo
        </button>
      )}
      {res && !res.ok && (
        <div role="alert" className="crm-error">
          {res.message}
        </div>
      )}
      {res?.ok && res.message && (
        <div role="status" className="crm-ok">
          {res.message}
        </div>
      )}
    </div>
  );
}
