"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EDITIONS, MAX_EXTRA_USERS } from "@/lib/plans";
import { requestContext, requireUser } from "@/server/auth/http";
import { hitRateLimit } from "@/server/auth/rate-limit";
import type { ChangePreview } from "@/server/billing/account";
import { createSubscriptionCheckout } from "@/server/billing/checkout";
import {
  beginCardUpdate,
  changePlan,
  completeCardUpdate,
  previewPlanChange,
  setCancel,
} from "@/server/billing/manage";
import { getStripe, isStripeConfigured } from "@/server/billing/stripe";
import { buildCtx } from "@/server/domain/context";

const Input = z.object({
  edition: z.enum(EDITIONS),
  extraUsers: z.number().int().min(0).max(MAX_EXTRA_USERS),
});

export type CheckoutStart =
  | { ok: true; clientSecret: string }
  | { ok: false; error: "invalid" | "unavailable" | "busy" | "failed" };

/**
 * Starts an on-site checkout for the plan and number of people chosen. Returns the client secret
 * the page needs to show the payment form inside Gantry, so nobody is sent away to Stripe.
 * The price is never taken from the browser: it is rebuilt here from the plan table.
 */
export async function createCheckoutSessionAction(input: unknown): Promise<CheckoutStart> {
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  if (!isStripeConfigured()) return { ok: false, error: "unavailable" };

  const { ip } = await requestContext();
  const limit = await hitRateLimit(`checkout:${ip}`, { max: 20, windowSeconds: 3600 });
  if (!limit.allowed) return { ok: false, error: "busy" };

  try {
    const clientSecret = await createSubscriptionCheckout(getStripe(), parsed.data);
    return { ok: true, clientSecret };
  } catch (err) {
    console.error("checkout session failed", err instanceof Error ? err.message : "unknown");
    return { ok: false, error: "failed" };
  }
}

// ---- The Billing page (Settings → Billing) ----------------------------------------------------
// Each action: sign-in, then the permission check inside the operation, then the work. Nothing
// here accepts a Stripe id from the browser: the business's own subscription is looked up.

export type BillingResult = { ok: true } | { ok: false; message: string };
const failure = (r: { message: string }): { ok: false; message: string } => ({
  ok: false,
  message: r.message,
});

const Choice = z.object({
  edition: z.enum(EDITIONS),
  extraUsers: z.number().int().min(0).max(MAX_EXTRA_USERS),
});
const BAD_INPUT = {
  ok: false,
  message: "Choose a plan and a number of people from 10 to 50.",
} as const;

async function context() {
  const user = await requireUser();
  return buildCtx(user.tenantId, user.userId);
}

/** What a change would cost, without making it. */
export async function previewPlanChangeAction(
  input: unknown,
): Promise<{ ok: true; preview: ChangePreview } | { ok: false; message: string }> {
  const parsed = Choice.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  const r = await previewPlanChange(await context(), parsed.data);
  return r.ok ? { ok: true, preview: r.preview } : failure(r);
}

/** Makes the change and charges the difference now. */
export async function changePlanAction(input: unknown): Promise<BillingResult> {
  const parsed = Choice.safeParse(input);
  if (!parsed.success) return BAD_INPUT;
  const r = await changePlan(await context(), parsed.data);
  if (!r.ok) return failure(r);
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Stops renewing at the end of the paid period, or carries on. */
export async function setCancelAction(cancel: unknown): Promise<BillingResult> {
  const parsed = z.boolean().safeParse(cancel);
  if (!parsed.success) return { ok: false, message: "Something went wrong. Please try again." };
  const r = await setCancel(await context(), parsed.data);
  if (!r.ok) return failure(r);
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Starts the card form that is drawn inside the page. */
export async function beginCardUpdateAction(): Promise<
  { ok: true; clientSecret: string } | { ok: false; message: string }
> {
  const r = await beginCardUpdate(await context());
  return r.ok ? { ok: true, clientSecret: r.clientSecret } : failure(r);
}

/** Makes the card that was just entered the one used from now on. */
export async function completeCardUpdateAction(
  setupIntentId: unknown,
): Promise<{ ok: true; retriedOverdue: boolean } | { ok: false; message: string }> {
  const r = await completeCardUpdate(await context(), setupIntentId);
  if (!r.ok) return failure(r);
  revalidatePath("/app", "layout");
  return { ok: true, retriedOverdue: r.retriedOverdue };
}
