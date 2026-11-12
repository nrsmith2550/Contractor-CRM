import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { address, standard } from "./sales";

// Service tables: cases ("incident"), their subjects and queues, and work orders. All are
// tenant-scoped (tenant_id + RLS via src/db/tenant-tables.ts) and owned (owner_id), like the
// sales tables. Records that point at each other (case <-> work order) use plain uuids.

/** A case category. Hierarchical: a subject may have a parent. */
export const subject = pgTable(
  "subject",
  {
    ...standard(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
  },
  (t) => [uniqueIndex("subject_name_uq").on(t.tenantId, t.parentId, t.name)],
);

/** A work queue cases can be routed to (e.g. "Support", "Dispatch"). */
export const queue = pgTable(
  "queue",
  {
    ...standard(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("queue_name_uq").on(t.tenantId, t.name)],
);

export const incident = pgTable(
  "incident",
  {
    ...standard(),
    ticketNumber: text("ticket_number").notNull(), // CAS-01001
    title: text("title").notNull(),
    customerAccountId: uuid("customer_account_id"),
    customerContactId: uuid("customer_contact_id"),
    subjectId: uuid("subject_id").references(() => subject.id),
    queueId: uuid("queue_id").references(() => queue.id),
    caseType: text("case_type").notNull().default("problem"), // question | problem | request
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    origin: text("origin").notNull().default("phone"), // phone | email | web
    description: text("description"),
    status: text("status").notNull().default("in_progress"), // in_progress | on_hold | waiting_on_customer | resolved | cancelled
    resolution: text("resolution"),
    billableMinutes: integer("billable_minutes"),
    /** When the case must be resolved by: set from its priority (see sla.ts). */
    slaDueAt: timestamp("sla_due_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("incident_ticket_uq").on(t.tenantId, t.ticketNumber),
    index("incident_status_idx").on(t.tenantId, t.status),
    index("incident_owner_idx").on(t.tenantId, t.ownerId),
  ],
);

export const workOrder = pgTable(
  "work_order",
  {
    ...standard(),
    woNumber: text("wo_number").notNull(), // WO-01001
    title: text("title").notNull(),
    incidentId: uuid("incident_id").references(() => incident.id),
    serviceAccountId: uuid("service_account_id"),
    incidentType: text("incident_type"), // what kind of job, e.g. "HVAC repair"
    workOrderType: text("work_order_type").notNull().default("repair"), // repair | maintenance | installation | inspection
    priority: text("priority").notNull().default("normal"), // low | normal | high | urgent
    instructions: text("instructions"),
    ...address(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    timeWindowStart: timestamp("time_window_start", { withTimezone: true }),
    timeWindowEnd: timestamp("time_window_end", { withTimezone: true }),
    estDurationMin: integer("est_duration_min"),
    status: text("status").notNull().default("unscheduled"), // unscheduled | scheduled | in_progress | completed | posted | cancelled
  },
  (t) => [
    uniqueIndex("work_order_number_uq").on(t.tenantId, t.woNumber),
    index("work_order_status_idx").on(t.tenantId, t.status),
    index("work_order_incident_idx").on(t.tenantId, t.incidentId),
  ],
);
