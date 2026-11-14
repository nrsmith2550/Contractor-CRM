import { count, desc, eq, isNull } from "drizzle-orm";
import { withPlatform, withTenant } from "@/db/client";
import { license, systemUser } from "@/db/schema";
import { hitRateLimit } from "@/server/auth/rate-limit";
import { recordAudit } from "@/server/domain/audit";
import {
  FORBIDDEN,
  fail,
  type Ctx,
  type ErrorCode,
  type Fail,
  type Result,
} from "@/server/domain/context";
import { can } from "@/server/security/roles";
import {
  BillingError,
  finishCardUpdate,
  listInvoices,
  overview,
  previewChange,
  applyChange,
  setCancelAtPeriodEnd,
  startCardUpdate,
  type Account,
  type Api,
  type ChangePreview,
  type InvoiceRow,
  type Overview,
} from "./account";
import { getStripe, isStripeConfigured, stripeMode } from "./stripe";
import { syncLicenseFromSubscription } from "./webhook";

/**
 * The Billing page's operations for one signed-in person. Each one checks they may manage billing,
 * finds their own business's subscription (never one named by the browser), does the work, records
 * it in the audit trail and brings the licence in line. The Stripe client can be passed in for tests.
 */
type Deps = { stripe?: Api };

const NOT_BILLED = fail(
  "unavailable",
  "Your plan is not billed through the site, so there is nothing to manage here. Contact us to change it.",
);

const BAD_LINK = fail(
  "unavailable",
  "We could not reach our payment provider just now. Please try again in a minute.",
);

type Found = { account: Account; licenseId: string; seatLimit: number; status: string };

async function find(ctx: Ctx): Promise<Found | Fail> {
  if (!can(ctx.subject, "license", "write")) return FORBIDDEN;
  const [lic] = await withPlatform((tx) =>
    tx
      .select()
      .from(license)
      .where(eq(license.tenantId, ctx.tenantId))
      .orderBy(desc(license.activatedAt))
      .limit(1),
  );
  if (!lic?.stripeSubscriptionId || !lic.stripeCustomerId) return NOT_BILLED;
  return {
    licenseId: lic.id,
    seatLimit: lic.seatLimit,
    status: lic.status,
    account: {
      edition: lic.edition,
      extraUsers: lic.extraUsers,
      stripeCustomerId: lic.stripeCustomerId,
      stripeSubscriptionId: lic.stripeSubscriptionId,
      billingStatus: lic.billingStatus,
    },
  };
}

const isFail = (x: Found | Fail): x is Fail => "ok" in x;

function stripeOf(deps: Deps): Api | null {
  if (deps.stripe) return deps.stripe;
  return isStripeConfigured() ? getStripe() : null;
}

const CODES: Record<string, ErrorCode> = {
  invalid: "invalid",
  unchanged: "invalid",
  below_active_users: "invalid",
  payment_failed: "conflict",
  not_yours: "forbidden",
};

/** A message a person can read for something that went wrong, without leaking Stripe's details. */
function problem(err: unknown) {
  if (err instanceof BillingError) return fail(CODES[err.code] ?? "invalid", err.message);
  console.error("billing failed", err instanceof Error ? err.message : "unknown");
  return BAD_LINK;
}

async function activeUsers(tenantId: string): Promise<number> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select({ n: count() }).from(systemUser).where(isNull(systemUser.disabledAt)),
  );
  return row?.n ?? 0;
}

async function limited(ctx: Ctx): Promise<Fail | null> {
  const hit = await hitRateLimit(`billing:${ctx.tenantId}`, { max: 40, windowSeconds: 3600 });
  return hit.allowed
    ? null
    : fail("rate_limited", "Too many billing changes in a short time. Please try again later.");
}

export type BillingView = {
  overview: Overview;
  invoices: InvoiceRow[];
  activeUsers: number;
  testMode: boolean;
  /** For the page to know whether the card form can be drawn. */
  canUpdateCard: boolean;
};

/** Everything the Billing page shows. */
export async function billingView(
  ctx: Ctx,
  deps: Deps = {},
): Promise<Result<{ view: BillingView }>> {
  const found = await find(ctx);
  if (isFail(found)) return found;
  const stripe = stripeOf(deps);
  if (!stripe) return BAD_LINK;
  try {
    const [o, invoices, users] = await Promise.all([
      overview(stripe, found.account),
      listInvoices(stripe, found.account),
      activeUsers(ctx.tenantId),
    ]);
    return {
      ok: true,
      view: {
        overview: o,
        invoices,
        activeUsers: users,
        testMode: stripeMode() === "test",
        canUpdateCard: Boolean(process.env.STRIPE_PUBLISHABLE_KEY),
      },
    };
  } catch (err) {
    return problem(err);
  }
}

export async function previewPlanChange(
  ctx: Ctx,
  choice: unknown,
  deps: Deps = {},
): Promise<Result<{ preview: ChangePreview }>> {
  const found = await find(ctx);
  if (isFail(found)) return found;
  const stripe = stripeOf(deps);
  if (!stripe) return BAD_LINK;
  try {
    const preview = await previewChange(
      stripe,
      found.account,
      choice,
      await activeUsers(ctx.tenantId),
    );
    return { ok: true, preview };
  } catch (err) {
    return problem(err);
  }
}

export async function changePlan(ctx: Ctx, choice: unknown, deps: Deps = {}): Promise<Result> {
  const found = await find(ctx);
  if (isFail(found)) return found;
  const stripe = stripeOf(deps);
  if (!stripe) return BAD_LINK;
  const slow = await limited(ctx);
  if (slow) return slow;
  try {
    const users = await activeUsers(ctx.tenantId);
    const sub = await applyChange(stripe, found.account, choice, users);
    await syncLicenseFromSubscription(sub);
    await withTenant(ctx.tenantId, (tx) =>
      recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "license",
        recordId: found.licenseId,
        action: "billing.change_plan",
        changes: {
          plan: { from: found.account.edition, to: (choice as { edition: string }).edition },
          extraUsers: {
            from: found.account.extraUsers,
            to: (choice as { extraUsers: number }).extraUsers,
          },
        },
      }),
    );
    return { ok: true };
  } catch (err) {
    return problem(err);
  }
}

export async function setCancel(ctx: Ctx, cancel: boolean, deps: Deps = {}): Promise<Result> {
  const found = await find(ctx);
  if (isFail(found)) return found;
  const stripe = stripeOf(deps);
  if (!stripe) return BAD_LINK;
  const slow = await limited(ctx);
  if (slow) return slow;
  try {
    const sub = await setCancelAtPeriodEnd(stripe, found.account, cancel);
    await syncLicenseFromSubscription(sub);
    await withTenant(ctx.tenantId, (tx) =>
      recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "license",
        recordId: found.licenseId,
        action: cancel ? "billing.cancel_at_period_end" : "billing.resume",
      }),
    );
    return { ok: true };
  } catch (err) {
    return problem(err);
  }
}

export async function beginCardUpdate(
  ctx: Ctx,
  deps: Deps = {},
): Promise<Result<{ clientSecret: string }>> {
  const found = await find(ctx);
  if (isFail(found)) return found;
  const stripe = stripeOf(deps);
  if (!stripe) return BAD_LINK;
  const slow = await limited(ctx);
  if (slow) return slow;
  try {
    return { ok: true, clientSecret: await startCardUpdate(stripe, found.account) };
  } catch (err) {
    return problem(err);
  }
}

export async function completeCardUpdate(
  ctx: Ctx,
  setupIntentId: unknown,
  deps: Deps = {},
): Promise<Result<{ retriedOverdue: boolean }>> {
  if (typeof setupIntentId !== "string" || !/^seti_[A-Za-z0-9_]+$/.test(setupIntentId)) {
    return fail("invalid", "That card could not be confirmed. Please try again.");
  }
  const found = await find(ctx);
  if (isFail(found)) return found;
  const stripe = stripeOf(deps);
  if (!stripe) return BAD_LINK;
  try {
    const { retriedOverdue } = await finishCardUpdate(stripe, found.account, setupIntentId);
    await withTenant(ctx.tenantId, (tx) =>
      recordAudit(tx, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        entity: "license",
        recordId: found.licenseId,
        action: "billing.update_card",
      }),
    );
    return { ok: true, retriedOverdue };
  } catch (err) {
    return problem(err);
  }
}
