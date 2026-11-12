import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenant } from "./platform";

// Every table in this file is tenant-scoped: `tenant_id not null`, an index that starts with
// tenant_id, and a Row-Level Security policy installed by src/db/rls.sql.

const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenant.id);

export const systemUser = pgTable(
  "system_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    isOwner: boolean("is_owner").notNull().default(false),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("system_user_tenant_idx").on(t.tenantId),
    // One account per email across the whole platform: login happens at a shared URL with
    // no tenant context. See docs/decisions/0002-phase-1-auth.md.
    uniqueIndex("system_user_email_uq").on(sql`lower(${t.email})`),
  ],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => systemUser.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_tenant_user_idx").on(t.tenantId, t.userId)],
);

export const passwordResetToken = pgTable(
  "password_reset_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => systemUser.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    issuedBy: text("issued_by").notNull().default("self"), // 'self' | 'admin'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("prt_tenant_user_idx").on(t.tenantId, t.userId)],
);

export const securityRole = pgTable(
  "security_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    privileges: jsonb("privileges").notNull(),
    isSystem: boolean("is_system").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("security_role_tenant_name_uq").on(t.tenantId, t.name)],
);

export const userRole = pgTable(
  "user_role",
  {
    tenantId: tenantId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => systemUser.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => securityRole.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.roleId] })],
);

export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    roleId: uuid("role_id").references(() => securityRole.id),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invitedBy: uuid("invited_by").references(() => systemUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invitation_tenant_idx").on(t.tenantId, t.email)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    entity: text("entity").notNull(),
    recordId: text("record_id"),
    action: text("action").notNull(),
    changes: jsonb("changes"),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_tenant_entity_idx").on(t.tenantId, t.entity, t.recordId)],
);

export const sequence = pgTable(
  "sequence",
  {
    tenantId: tenantId(),
    entity: text("entity").notNull(),
    prefix: text("prefix").notNull(),
    nextValue: integer("next_value").notNull().default(1001),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.entity] })],
);
