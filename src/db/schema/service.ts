import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { systemUser } from "./identity";
import { tenant } from "./platform";
import { address, cents, standard } from "./sales";

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

// ---- Resources, skills and bookings ------------------------------------------------------------

/** A skill such as "HVAC certified". Resources have skills; work orders can require them. */
export const characteristic = pgTable(
  "characteristic",
  {
    ...standard(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("characteristic_name_uq").on(t.tenantId, t.name)],
);

/** Something that can be booked onto work orders: a person, a crew, or a piece of equipment. */
export const bookableResource = pgTable(
  "bookable_resource",
  {
    ...standard(),
    name: text("name").notNull(),
    resourceType: text("resource_type").notNull().default("user"), // user | crew | equipment
    /** The technician's sign-in, for a "user" resource: it is what lets them see their bookings. */
    userId: uuid("user_id").references(() => systemUser.id),
    /** Weekly working hours in the business's time zone (see work-hours.ts). */
    workHours: jsonb("work_hours").notNull(),
    color: text("color"),
    ...address(),
  },
  (t) => [uniqueIndex("bookable_resource_name_uq").on(t.tenantId, t.name)],
);

export const resourceCharacteristic = pgTable(
  "resource_characteristic",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => bookableResource.id, { onDelete: "cascade" }),
    characteristicId: uuid("characteristic_id")
      .notNull()
      .references(() => characteristic.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("resource_characteristic_uq").on(t.resourceId, t.characteristicId)],
);

/** Skills a work order needs. A booking onto a resource that lacks one gets a warning. */
export const workOrderSkill = pgTable(
  "work_order_skill",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    characteristicId: uuid("characteristic_id")
      .notNull()
      .references(() => characteristic.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("work_order_skill_uq").on(t.workOrderId, t.characteristicId)],
);

/** A resource booked onto a work order for a stretch of time. Owned by the technician it's for. */
export const resourceBooking = pgTable(
  "resource_booking",
  {
    ...standard(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => bookableResource.id),
    workOrderId: uuid("work_order_id").references(() => workOrder.id),
    /** Set when the visit is for one phase of the job rather than the job as a whole. */
    phaseId: uuid("phase_id").references(() => jobPhase.id, { onDelete: "set null" }),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"), // scheduled | travelling | in_progress | completed | cancelled
    notes: text("notes"),
    travellingAt: timestamp("travelling_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Customer sign-off captured on site: a small PNG data URL plus who signed. */
    signatureDataUrl: text("signature_data_url"),
    signedByName: text("signed_by_name"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
  },
  (t) => [
    index("booking_resource_time_idx").on(t.tenantId, t.resourceId, t.startAt),
    index("booking_work_order_idx").on(t.tenantId, t.workOrderId),
    index("booking_phase_idx").on(t.phaseId),
  ],
);

// ---- Phases of a job (each is its own small job, linked to the main job) -----------------------

/**
 * A job can be split into phases, for example "Demo", "Rough-in" and "Final inspection", or one
 * phase for each technician. A phase has its own title, instructions, status and time estimate, and
 * (later) its own bookings, parts and labour. The main job stays the one record the customer sees.
 */
export const jobPhase = pgTable(
  "job_phase",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    phaseNumber: integer("phase_number").notNull(), // 1, 2, 3 within the job
    title: text("title").notNull(),
    instructions: text("instructions"),
    status: text("status").notNull().default("unscheduled"), // unscheduled | scheduled | in_progress | completed | cancelled
    estDurationMin: integer("est_duration_min"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => systemUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    modifiedBy: uuid("modified_by").references(() => systemUser.id),
    modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_phase_number_uq").on(t.workOrderId, t.phaseNumber),
    index("job_phase_status_idx").on(t.tenantId, t.status),
  ],
);

// ---- Parts and labour used on a work order (these feed an invoice later) ------------------------

export const workOrderProduct = pgTable(
  "work_order_product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    /** The phase the part was used on, or null for the job as a whole. */
    phaseId: uuid("phase_id").references(() => jobPhase.id, { onDelete: "set null" }),
    productId: uuid("product_id"),
    description: text("description").notNull(), // product name, or a write-in
    quantityMilli: cents("quantity_milli").notNull(), // 1000 = 1
    unitPriceCents: cents("unit_price_cents").notNull(),
    extendedCents: cents("extended_cents").notNull().default(0),
    addedBy: uuid("added_by").references(() => systemUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_order_product_line_uq").on(t.workOrderId, t.lineNumber)],
);

export const workOrderService = pgTable(
  "work_order_service",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrder.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    /** The phase the work was done on, or null for the job as a whole. */
    phaseId: uuid("phase_id").references(() => jobPhase.id, { onDelete: "set null" }),
    resourceId: uuid("resource_id").references(() => bookableResource.id),
    description: text("description").notNull(), // e.g. "Labour"
    minutes: integer("minutes").notNull(),
    hourlyRateCents: cents("hourly_rate_cents").notNull(),
    extendedCents: cents("extended_cents").notNull().default(0),
    addedBy: uuid("added_by").references(() => systemUser.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_order_service_line_uq").on(t.workOrderId, t.lineNumber)],
);
