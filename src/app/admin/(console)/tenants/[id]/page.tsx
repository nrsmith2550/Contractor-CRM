import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TIER_IDS, TIERS } from "@/lib/tiers";
import {
  licenseStatusAction,
  licenseTierAction,
  ownerChangeEmailAction,
  ownerReactivateAction,
  ownerResetLinkAction,
  ownerTempPasswordAction,
} from "@/server/actions/admin";
import { getTenantDetail } from "@/server/admin/operations";
import { AdminActionForm, REASON_FIELD } from "../../../admin-forms";

export const metadata: Metadata = { title: "Business" };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const t = await getTenantDetail(id);
  if (!t) notFound();

  return (
    <main>
      <p>
        <Link href="/admin/tenants">← Businesses</Link>
      </p>
      <h1>{t.name}</h1>
      <p>
        {t.slug} · {t.timeZone} · {t.currency} · created {t.createdAt.toISOString().slice(0, 10)}
      </p>
      <p>
        <strong>License:</strong> {t.tier} (…{t.keyLast5}), {t.activeUsers} of {t.seatLimit} seats
        in use, status <strong>{t.licenseStatus}</strong>
      </p>
      <p>
        <strong>Owner:</strong>{" "}
        {t.owner
          ? `${t.owner.fullName} <${t.owner.email}>`
          : "none — the license is awaiting a new owner"}
      </p>

      <h2>Owner access</h2>
      <p>
        Passwords are never stored in a readable form, not even here. These actions each require a
        reason, are written to the audit log, and sign the owner out.
      </p>
      <h3>Send reset link</h3>
      <p>Emails the owner a single-use link at the address on file.</p>
      <AdminActionForm
        action={ownerResetLinkAction}
        fixed={{ tenantId: t.id }}
        submitLabel="Send reset link"
        fields={[REASON_FIELD]}
        clearOnSuccess
      />
      <h3>Issue a temporary password</h3>
      <p>For owners who have lost access to their email. Shown to you once; they must change it.</p>
      <AdminActionForm
        action={ownerTempPasswordAction}
        fixed={{ tenantId: t.id }}
        submitLabel="Issue temporary password"
        confirmText="Issue a temporary password? The owner will be signed out."
        fields={[REASON_FIELD]}
        clearOnSuccess
      />
      <h3>Change owner email</h3>
      <p>For when the owner has left the company. The old and the new address are both notified.</p>
      <AdminActionForm
        action={ownerChangeEmailAction}
        fixed={{ tenantId: t.id }}
        submitLabel="Change owner email"
        fields={[
          { name: "newEmail", label: "New owner email", type: "email", required: true },
          REASON_FIELD,
        ]}
        clearOnSuccess
      />
      <h3>Re-activate (last resort)</h3>
      <p>
        Disables the current owner and returns the license to a claimable state, so the business can
        set a new owner on the activation page using its key. All business data is kept. Everyone is
        signed out until the key is claimed.
      </p>
      <AdminActionForm
        action={ownerReactivateAction}
        fixed={{ tenantId: t.id }}
        submitLabel="Re-activate license"
        confirmText="Return this license to a claimable state? Everyone in the business will be signed out."
        danger
        fields={[REASON_FIELD]}
      />

      <h2>License</h2>
      <h3>Suspend, revoke or reinstate</h3>
      <AdminActionForm
        action={licenseStatusAction}
        fixed={{ licenseId: t.licenseId ?? "" }}
        submitLabel="Apply"
        fields={[
          {
            name: "action",
            label: "Action",
            type: "select",
            options: [
              { value: "suspend", label: "Suspend" },
              { value: "revoke", label: "Revoke" },
              { value: "reinstate", label: "Reinstate" },
            ],
          },
          REASON_FIELD,
        ]}
      />
      <h3>Change tier or seats</h3>
      <AdminActionForm
        action={licenseTierAction}
        fixed={{ licenseId: t.licenseId ?? "" }}
        submitLabel="Update"
        fields={[
          {
            name: "tier",
            label: "Tier",
            type: "select",
            defaultValue: t.tier ?? undefined,
            options: TIER_IDS.map((x) => ({
              value: x,
              label: `${TIERS[x].label} — ${TIERS[x].seats}`,
            })),
          },
          {
            name: "seatLimit",
            label: "Seat limit (optional)",
            type: "number",
            hint: "Blank = the tier's limit",
          },
          REASON_FIELD,
        ]}
      />
    </main>
  );
}
