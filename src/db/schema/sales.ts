import {
  bigint,
  boolean,
  date,
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

// Sales tables. Every one is tenant-scoped (tenant_id + RLS via src/db/tenant-tables.ts) and
// owned (owner_id), mirroring Dynamics ownership: security roles grant access at "user" depth
// (own records) or "organization" depth. Cross-references between records that point at each
// other (lead <-> opportunity, account <-> contact) are plain uuids without foreign keys, to
// avoid circular constraints; the domain layer keeps them consistent and every read is RLS-fenced.

const standard = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenant.id),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => systemUser.id),
  createdBy: uuid("created_by").references(() => systemUser.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  modifiedBy: uuid("modified_by").references(() => systemUser.id),
  modifiedAt: timestamp("modified_at", { withTimezone: true }).notNull().defaultNow(),
  stateCode: text("state_code").notNull().default("active"), // active | inactive
});

const address = () => ({
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressRegion: text("address_region"),
  addressPostalCode: text("address_postal_code"),
  addressCountry: text("address_country"),
});

/** Money is always integer cents. */
const cents = (name: string) => bigint(name, { mode: "number" });

export const lead = pgTable(
  "lead",
  {
    ...standard(),
    leadNumber: text("lead_number").notNull(),
    topic: text("topic").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name").notNull(),
    jobTitle: text("job_title"),
    companyName: text("company_name"),
    email: text("email"),
    phone: text("phone"),
    ...address(),
    leadSource: text("lead_source"),
    rating: text("rating"), // hot | warm | cold
    estValueCents: cents("est_value_cents"),
    status: text("status").notNull().default("new"), // new | contacted | qualified | disqualified
    disqualifyReason: text("disqualify_reason"),
    qualifiedAccountId: uuid("qualified_account_id"),
    qualifiedContactId: uuid("qualified_contact_id"),
    qualifiedOpportunityId: uuid("qualified_opportunity_id"),
  },
  (t) => [
    uniqueIndex("lead_number_uq").on(t.tenantId, t.leadNumber),
    index("lead_owner_idx").on(t.tenantId, t.ownerId),
    index("lead_status_idx").on(t.tenantId, t.status),
  ],
);

export const account = pgTable(
  "account",
  {
    ...standard(),
    accountNumber: text("account_number").notNull(),
    name: text("name").notNull(),
    primaryContactId: uuid("primary_contact_id"),
    parentAccountId: uuid("parent_account_id"),
    phone: text("phone"),
    website: text("website"),
    industry: text("industry"),
    ...address(),
    relationshipType: text("relationship_type").notNull().default("prospect"), // prospect | customer | vendor | partner
    creditLimitCents: cents("credit_limit_cents"),
    paymentTerms: text("payment_terms"),
  },
  (t) => [
    uniqueIndex("account_number_uq").on(t.tenantId, t.accountNumber),
    index("account_owner_idx").on(t.tenantId, t.ownerId),
    index("account_name_idx").on(t.tenantId, t.name),
  ],
);

export const contact = pgTable(
  "contact",
  {
    ...standard(),
    contactNumber: text("contact_number").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name").notNull(),
    parentAccountId: uuid("parent_account_id"),
    jobTitle: text("job_title"),
    email: text("email"),
    mobile: text("mobile"),
    businessPhone: text("business_phone"),
    ...address(),
    preferredContactMethod: text("preferred_contact_method"),
  },
  (t) => [
    uniqueIndex("contact_number_uq").on(t.tenantId, t.contactNumber),
    index("contact_owner_idx").on(t.tenantId, t.ownerId),
    index("contact_account_idx").on(t.tenantId, t.parentAccountId),
  ],
);

export const opportunity = pgTable(
  "opportunity",
  {
    ...standard(),
    opportunityNumber: text("opportunity_number").notNull(),
    name: text("name").notNull(),
    customerAccountId: uuid("customer_account_id"),
    customerContactId: uuid("customer_contact_id"),
    originatingLeadId: uuid("originating_lead_id"),
    estRevenueCents: cents("est_revenue_cents").notNull().default(0),
    estCloseDate: date("est_close_date", { mode: "string" }),
    probability: integer("probability").notNull().default(10),
    stage: text("stage").notNull().default("qualify"), // qualify | develop | propose | close
    budgetCents: cents("budget_cents"),
    purchaseTimeframe: text("purchase_timeframe"),
    proposalDelivered: boolean("proposal_delivered").notNull().default(false),
    status: text("status").notNull().default("open"), // open | won | lost
    closeReason: text("close_reason"),
    competitor: text("competitor"),
    actualRevenueCents: cents("actual_revenue_cents"),
    actualCloseDate: date("actual_close_date", { mode: "string" }),
  },
  (t) => [
    uniqueIndex("opportunity_number_uq").on(t.tenantId, t.opportunityNumber),
    index("opportunity_owner_idx").on(t.tenantId, t.ownerId),
    index("opportunity_status_stage_idx").on(t.tenantId, t.status, t.stage),
  ],
);

/**
 * Products on an opportunity. While an opportunity has lines its estimated revenue is the sum of
 * their amounts (calculated by the domain layer); with no lines the user enters it by hand.
 */
export const opportunityProduct = pgTable(
  "opportunity_product",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    productId: uuid("product_id").references(() => product.id),
    description: text("description").notNull(), // product name, or a write-in
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(), // 1000 = 1
    unitPriceCents: cents("unit_price_cents").notNull(),
    discountCents: cents("discount_cents").notNull().default(0),
    extendedCents: cents("extended_cents").notNull().default(0),
  },
  (t) => [uniqueIndex("opportunity_product_line_uq").on(t.opportunityId, t.lineNumber)],
);

/** Tasks, phone calls, emails (logged) and appointments, attached to any record. */
export const activity = pgTable(
  "activity",
  {
    ...standard(),
    activityType: text("activity_type").notNull(), // task | phone_call | email | appointment
    subject: text("subject").notNull(),
    description: text("description"),
    regardingType: text("regarding_type"),
    regardingId: uuid("regarding_id"),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: text("priority").notNull().default("normal"),
    direction: text("direction"),
    status: text("status").notNull().default("open"), // open | completed | cancelled
  },
  (t) => [
    index("activity_regarding_idx").on(t.tenantId, t.regardingType, t.regardingId),
    index("activity_owner_idx").on(t.tenantId, t.ownerId),
  ],
);

/** Notes on a record's timeline. */
export const annotation = pgTable(
  "annotation",
  {
    ...standard(),
    regardingType: text("regarding_type").notNull(),
    regardingId: uuid("regarding_id").notNull(),
    title: text("title"),
    body: text("body").notNull(),
  },
  (t) => [index("annotation_regarding_idx").on(t.tenantId, t.regardingType, t.regardingId)],
);

export const savedView = pgTable(
  "saved_view",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    ownerId: uuid("owner_id").references(() => systemUser.id), // null for system views
    entity: text("entity").notNull(),
    name: text("name").notNull(),
    columns: jsonb("columns").notNull(),
    filters: jsonb("filters").notNull(),
    sort: jsonb("sort"),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_view_entity_idx").on(t.tenantId, t.entity)],
);

// ---- Phase 3: product catalog, quotes, orders -------------------------------------------------

export const unitOfMeasure = pgTable(
  "unit_of_measure",
  {
    ...standard(),
    name: text("name").notNull(),
    abbreviation: text("abbreviation").notNull(),
  },
  (t) => [uniqueIndex("uom_name_uq").on(t.tenantId, t.name)],
);

/** Tax rate in basis points (825 = 8.25%). */
export const taxRate = pgTable(
  "tax_rate",
  {
    ...standard(),
    name: text("name").notNull(),
    rateBp: integer("rate_bp").notNull(),
  },
  (t) => [uniqueIndex("tax_rate_name_uq").on(t.tenantId, t.name)],
);

export const product = pgTable(
  "product",
  {
    ...standard(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    productType: text("product_type").notNull().default("product"), // product | service
    uomId: uuid("uom_id").references(() => unitOfMeasure.id),
    standardCostCents: cents("standard_cost_cents"),
    listPriceCents: cents("list_price_cents").notNull().default(0),
    taxRateId: uuid("tax_rate_id").references(() => taxRate.id),
  },
  (t) => [uniqueIndex("product_sku_uq").on(t.tenantId, t.sku)],
);

export const priceList = pgTable(
  "price_list",
  {
    ...standard(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("USD"),
    beginDate: date("begin_date"),
    endDate: date("end_date"),
  },
  (t) => [uniqueIndex("price_list_name_uq").on(t.tenantId, t.name)],
);

export const priceListItem = pgTable(
  "price_list_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceList.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => product.id),
    amountCents: cents("amount_cents").notNull(),
  },
  (t) => [uniqueIndex("price_list_item_uq").on(t.priceListId, t.productId)],
);

export const quote = pgTable(
  "quote",
  {
    ...standard(),
    quoteNumber: text("quote_number").notNull(), // QUO-00001, revisions QUO-00001-R1
    baseNumber: text("base_number").notNull(), // QUO-00001 (shared by all revisions)
    revisionNumber: integer("revision_number").notNull().default(0),
    name: text("name").notNull(),
    opportunityId: uuid("opportunity_id"),
    customerAccountId: uuid("customer_account_id"),
    customerContactId: uuid("customer_contact_id"),
    priceListId: uuid("price_list_id").references(() => priceList.id),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    paymentTerms: text("payment_terms"),
    termsText: text("terms_text"),
    freightCents: cents("freight_cents").notNull().default(0),
    discountPercentBp: integer("discount_percent_bp"), // percent OR amount, never both
    discountAmountCents: cents("discount_amount_cents"),
    subtotalCents: cents("subtotal_cents").notNull().default(0),
    discountCents: cents("discount_cents").notNull().default(0),
    taxCents: cents("tax_cents").notNull().default(0),
    totalCents: cents("total_cents").notNull().default(0),
    status: text("status").notNull().default("draft"), // draft | active | won | lost | revised
    ...address(),
  },
  (t) => [
    uniqueIndex("quote_number_uq").on(t.tenantId, t.quoteNumber),
    index("quote_opportunity_idx").on(t.tenantId, t.opportunityId),
  ],
);

export const quoteDetail = pgTable(
  "quote_detail",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenant.id),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    productId: uuid("product_id").references(() => product.id),
    description: text("description").notNull(), // product name, or a write-in
    quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(), // 1000 = 1
    unitPriceCents: cents("unit_price_cents").notNull(),
    discountCents: cents("discount_cents").notNull().default(0),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    extendedCents: cents("extended_cents").notNull().default(0),
  },
  (t) => [uniqueIndex("quote_detail_line_uq").on(t.quoteId, t.lineNumber)],
);

export const salesOrder = pgTable(
  "sales_order",
  {
    ...standard(),
    orderNumber: text("order_number").notNull(),
    quoteId: uuid("quote_id"),
    opportunityId: uuid("opportunity_id"),
    customerAccountId: uuid("customer_account_id"),
    customerContactId: uuid("customer_contact_id"),
    name: text("name").notNull(),
    subtotalCents: cents("subtotal_cents").notNull().default(0),
    discountCents: cents("discount_cents").notNull().default(0),
    freightCents: cents("freight_cents").notNull().default(0),
    taxCents: cents("tax_cents").notNull().default(0),
    totalCents: cents("total_cents").notNull().default(0),
    fulfillmentStatus: text("fulfillment_status").notNull().default("new"), // new | processing | fulfilled | canceled
  },
  (t) => [
    uniqueIndex("sales_order_number_uq").on(t.tenantId, t.orderNumber),
    uniqueIndex("sales_order_quote_uq").on(t.tenantId, t.quoteId),
  ],
);

export const salesOrderDetail = pgTable("sales_order_detail", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenant.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => salesOrder.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull(),
  productId: uuid("product_id").references(() => product.id),
  description: text("description").notNull(),
  quantityMilli: bigint("quantity_milli", { mode: "number" }).notNull(),
  unitPriceCents: cents("unit_price_cents").notNull(),
  discountCents: cents("discount_cents").notNull().default(0),
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  extendedCents: cents("extended_cents").notNull().default(0),
});
