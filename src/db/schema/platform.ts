import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Platform tables are NOT tenant-scoped (no tenant_id / RLS), except `license.tenant_id`
// which points at the tenant a key is bound to.

export const licenseTier = pgEnum("license_tier", ["starter", "team", "business", "enterprise"]);
export const licenseStatus = pgEnum("license_status", ["issued", "active", "suspended", "revoked"]);

export const tenant = pgTable("tenant", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timeZone: text("time_zone").notNull().default("UTC"),
  currency: text("currency").notNull().default("USD"),
  logoUrl: text("logo_url"),
  settings: jsonb("settings")
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const license = pgTable(
  "license",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // sha256 of the canonical key. The full key is never stored.
    keyHash: text("key_hash").notNull().unique(),
    keyLast5: text("key_last5").notNull(),
    tier: licenseTier("tier").notNull(),
    seatLimit: integer("seat_limit").notNull(),
    status: licenseStatus("status").notNull().default("issued"),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    buyerEmail: text("buyer_email"),
    tenantId: uuid("tenant_id").references(() => tenant.id),
    stripeCustomerId: text("stripe_customer_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("license_tenant_idx").on(t.tenantId)],
);

export const platformAdmin = pgTable("platform_admin", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // AES-GCM encrypted TOTP secret (base64). Never stored in plain text.
  totpSecretEnc: text("totp_secret_enc"),
  // Highest TOTP time step already accepted, so a code (even a valid one) can't be replayed.
  totpLastStep: integer("totp_last_step"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminSession = pgTable("admin_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id")
    .notNull()
    .references(() => platformAdmin.id),
  tokenHash: text("token_hash").notNull().unique(),
  totpVerifiedAt: timestamp("totp_verified_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only: rls.sql installs a trigger that rejects UPDATE and DELETE.
export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: uuid("admin_id"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  reason: text("reason"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Security events (activation / login failures etc.). No secrets, ever.
export const authEvent = pgTable(
  "auth_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    ip: text("ip"),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_event_created_idx").on(t.createdAt)],
);

// Stripe events already handled. Stripe delivers at least once, so the webhook inserts the
// event id here in the same transaction as its effects; a duplicate delivery is a no-op.
export const stripeEvent = pgTable("stripe_event", {
  id: text("id").primaryKey(), // evt_...
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// Postgres-backed fixed-window rate limit counters.
export const rateLimit = pgTable("rate_limit", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
  count: integer("count").notNull().default(0),
});
