"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminLogout, adminPasswordLogin, adminVerifyTotp } from "@/server/admin/auth";
import {
  assertAdminAccess,
  clearAdminCookie,
  getAdminToken,
  requireAdmin,
  setAdminCookie,
} from "@/server/admin/http";
import {
  changeOwnerEmail,
  issueOwnerTemporaryPassword,
  mintLicenseAsAdmin,
  reactivateLicense,
  sendOwnerResetLink,
  setLicenseStatus,
  updateLicenseTier,
} from "@/server/admin/operations";

/** `secret` is something the admin must copy now: it is never stored and can't be shown again. */
export type AdminActionResult =
  | { ok: true; message: string; secret?: { label: string; value: string } }
  | { ok: false; message: string };

type Values = Record<string, string>;
const vals = (v: unknown): Values =>
  typeof v === "object" && v !== null ? (v as Values) : ({} as Values);

// ── sign-in (two stages) ────────────────────────────────────────────────────

export async function adminLoginAction(values: unknown): Promise<AdminActionResult> {
  const { ip } = await assertAdminAccess();
  const v = vals(values);
  const res = await adminPasswordLogin({ email: v.email, password: v.password, ip });
  if (!res.ok) return { ok: false, message: res.message };
  await setAdminCookie(res.token);
  redirect("/admin/verify");
}

export async function adminVerifyAction(values: unknown): Promise<AdminActionResult> {
  const { ip } = await assertAdminAccess();
  const res = await adminVerifyTotp({
    token: await getAdminToken(),
    code: vals(values).code,
    ip,
  });
  if (!res.ok) {
    if (res.code === "invalid_session") redirect("/admin/login");
    return { ok: false, message: res.message };
  }
  redirect("/admin");
}

export async function adminLogoutAction(): Promise<void> {
  const admin = await requireAdmin();
  await adminLogout(admin.sessionId, admin.admin.id, admin.ip);
  await clearAdminCookie();
  redirect("/admin/login");
}

// ── console actions: allowlist → verified session → Zod/domain → audit ──────

async function ctx() {
  const a = await requireAdmin();
  return { adminId: a.admin.id, ip: a.ip };
}

export async function mintLicenseAction(values: unknown): Promise<AdminActionResult> {
  const res = await mintLicenseAsAdmin(await ctx(), vals(values));
  if (!res.ok) return res;
  revalidatePath("/admin/licenses");
  return {
    ok: true,
    message: `License minted (…${res.last5}). Copy the key now: it can't be shown again.`,
    secret: { label: "License key", value: res.key },
  };
}

export async function licenseStatusAction(values: unknown): Promise<AdminActionResult> {
  const res = await setLicenseStatus(await ctx(), vals(values));
  if (!res.ok) return res;
  revalidatePath("/admin", "layout");
  return { ok: true, message: `License is now ${res.status}.` };
}

export async function licenseTierAction(values: unknown): Promise<AdminActionResult> {
  const res = await updateLicenseTier(await ctx(), vals(values));
  if (!res.ok) return res;
  revalidatePath("/admin", "layout");
  return { ok: true, message: `Tier is now ${res.tier} with ${res.seatLimit} seats.` };
}

export async function ownerResetLinkAction(values: unknown): Promise<AdminActionResult> {
  const res = await sendOwnerResetLink(await ctx(), vals(values));
  if (!res.ok) return res;
  return { ok: true, message: "Reset link emailed to the owner. Their sessions were signed out." };
}

export async function ownerTempPasswordAction(values: unknown): Promise<AdminActionResult> {
  const res = await issueOwnerTemporaryPassword(await ctx(), vals(values));
  if (!res.ok) return res;
  return {
    ok: true,
    message: `Temporary password set for ${res.ownerEmail}. Give it to them securely; they must change it at next sign-in.`,
    secret: { label: "Temporary password", value: res.temporaryPassword },
  };
}

export async function ownerChangeEmailAction(values: unknown): Promise<AdminActionResult> {
  const res = await changeOwnerEmail(await ctx(), vals(values));
  if (!res.ok) return res;
  revalidatePath("/admin", "layout");
  return {
    ok: true,
    message: `Owner email changed to ${res.newEmail}. Both addresses were notified.`,
  };
}

export async function ownerReactivateAction(values: unknown): Promise<AdminActionResult> {
  const res = await reactivateLicense(await ctx(), vals(values));
  if (!res.ok) return res;
  revalidatePath("/admin", "layout");
  return {
    ok: true,
    message:
      "License returned to a claimable state. The business can set a new owner on the activation page with its key; its data is kept.",
  };
}
