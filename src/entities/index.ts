import type { EntityKey, EntityMeta, Option } from "./types";

const title = (v: string) => v.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const opts = (values: string[]): Option[] =>
  values.map((value) => ({ value, label: title(value) }));

const ADDRESS = (section = "Address") =>
  [
    ["addressStreet", "Street"],
    ["addressCity", "City"],
    ["addressRegion", "State / region"],
    ["addressPostalCode", "ZIP / postal code"],
    ["addressCountry", "Country"],
  ].map(([name, label]) => ({ name: name!, label: label!, type: "text" as const, section }));

export const LEAD: EntityMeta = {
  key: "lead",
  slug: "leads",
  singular: "Lead",
  plural: "Leads",
  numberField: "leadNumber",
  titleFields: ["topic"],
  columns: [
    { name: "leadNumber", label: "Number" },
    { name: "topic", label: "Topic" },
    { name: "lastName", label: "Last name" },
    { name: "companyName", label: "Company" },
    { name: "status", label: "Status", type: "badge" },
    { name: "rating", label: "Rating", type: "badge" },
    { name: "estValueCents", label: "Est. value", type: "money" },
    { name: "createdAt", label: "Created", type: "date" },
  ],
  views: [
    { id: "my_open", label: "My Open Leads" },
    { id: "all_open", label: "All Open Leads" },
    { id: "this_week", label: "Leads Opened This Week" },
    { id: "disqualified", label: "Disqualified Leads" },
  ],
  defaultView: "my_open",
  headerFields: ["status", "rating", "leadSource", "estValueCents"],
  fields: [
    {
      name: "topic",
      label: "Topic",
      type: "text",
      section: "Summary",
      hint: "Defaults to the company and last name",
    },
    { name: "firstName", label: "First name", type: "text", section: "Summary" },
    { name: "lastName", label: "Last name", type: "text", section: "Summary", required: true },
    { name: "jobTitle", label: "Job title", type: "text", section: "Summary" },
    { name: "companyName", label: "Company", type: "text", section: "Summary", recommended: true },
    { name: "email", label: "Email", type: "email", section: "Summary", recommended: true },
    { name: "phone", label: "Phone", type: "tel", section: "Summary" },
    {
      name: "leadSource",
      label: "Lead source",
      type: "select",
      section: "Details",
      options: opts(["web", "phone", "referral", "trade_show", "email", "other"]),
    },
    {
      name: "rating",
      label: "Rating",
      type: "select",
      section: "Details",
      options: opts(["hot", "warm", "cold"]),
    },
    { name: "estValueCents", label: "Est. value", type: "money", section: "Details" },
    ...ADDRESS(),
  ],
};

export const ACCOUNT: EntityMeta = {
  key: "account",
  slug: "accounts",
  singular: "Account",
  plural: "Accounts",
  numberField: "accountNumber",
  titleFields: ["name"],
  columns: [
    { name: "accountNumber", label: "Number" },
    { name: "name", label: "Account name" },
    { name: "relationshipType", label: "Relationship", type: "badge" },
    { name: "phone", label: "Phone" },
    { name: "industry", label: "Industry" },
    { name: "createdAt", label: "Created", type: "date" },
  ],
  views: [
    { id: "all", label: "All Accounts" },
    { id: "customers", label: "Customers" },
    { id: "prospects", label: "Prospects" },
  ],
  defaultView: "all",
  headerFields: ["relationshipType", "phone", "industry", "paymentTerms"],
  fields: [
    { name: "name", label: "Account name", type: "text", section: "Summary", required: true },
    { name: "phone", label: "Phone", type: "tel", section: "Summary", recommended: true },
    { name: "website", label: "Website", type: "url", section: "Summary" },
    { name: "industry", label: "Industry", type: "text", section: "Summary" },
    {
      name: "relationshipType",
      label: "Relationship type",
      type: "select",
      section: "Summary",
      options: opts(["prospect", "customer", "vendor", "partner"]),
    },
    {
      name: "parentAccountId",
      label: "Parent account",
      type: "lookup",
      lookup: "account",
      section: "Details",
    },
    {
      name: "primaryContactId",
      label: "Primary contact",
      type: "lookup",
      lookup: "contact",
      section: "Details",
    },
    { name: "paymentTerms", label: "Payment terms", type: "text", section: "Details" },
    { name: "creditLimitCents", label: "Credit limit", type: "money", section: "Details" },
    ...ADDRESS(),
  ],
};

export const CONTACT: EntityMeta = {
  key: "contact",
  slug: "contacts",
  singular: "Contact",
  plural: "Contacts",
  numberField: "contactNumber",
  titleFields: ["firstName", "lastName"],
  columns: [
    { name: "contactNumber", label: "Number" },
    { name: "lastName", label: "Last name" },
    { name: "firstName", label: "First name" },
    { name: "email", label: "Email" },
    { name: "businessPhone", label: "Business phone" },
    { name: "jobTitle", label: "Job title" },
  ],
  views: [{ id: "all", label: "All Contacts" }],
  defaultView: "all",
  headerFields: ["jobTitle", "email", "businessPhone", "mobile"],
  fields: [
    { name: "firstName", label: "First name", type: "text", section: "Summary" },
    { name: "lastName", label: "Last name", type: "text", section: "Summary", required: true },
    {
      name: "parentAccountId",
      label: "Account",
      type: "lookup",
      lookup: "account",
      section: "Summary",
      recommended: true,
    },
    { name: "jobTitle", label: "Job title", type: "text", section: "Summary" },
    { name: "email", label: "Email", type: "email", section: "Summary", recommended: true },
    { name: "mobile", label: "Mobile", type: "tel", section: "Details" },
    { name: "businessPhone", label: "Business phone", type: "tel", section: "Details" },
    {
      name: "preferredContactMethod",
      label: "Preferred contact method",
      type: "select",
      section: "Details",
      options: opts(["email", "phone", "mobile", "any"]),
    },
    ...ADDRESS(),
  ],
};

export const OPPORTUNITY: EntityMeta = {
  key: "opportunity",
  slug: "opportunities",
  singular: "Opportunity",
  plural: "Opportunities",
  numberField: "opportunityNumber",
  titleFields: ["name"],
  columns: [
    { name: "opportunityNumber", label: "Number" },
    { name: "name", label: "Topic" },
    { name: "stage", label: "Stage", type: "badge" },
    { name: "status", label: "Status", type: "badge" },
    { name: "estRevenueCents", label: "Est. revenue", type: "money" },
    { name: "estCloseDate", label: "Est. close", type: "date" },
    { name: "probability", label: "Probability %" },
  ],
  views: [
    { id: "my_open", label: "My Open Opportunities" },
    { id: "open", label: "Open Opportunities" },
    { id: "closing_30", label: "Closing Next 30 Days" },
    { id: "won", label: "Won" },
    { id: "lost", label: "Lost" },
  ],
  defaultView: "my_open",
  headerFields: ["estRevenueCents", "estCloseDate", "probability", "stage"],
  fields: [
    { name: "name", label: "Topic", type: "text", section: "Summary", required: true },
    {
      name: "customerAccountId",
      label: "Account",
      type: "lookup",
      lookup: "account",
      section: "Summary",
      recommended: true,
    },
    {
      name: "customerContactId",
      label: "Contact",
      type: "lookup",
      lookup: "contact",
      section: "Summary",
    },
    {
      name: "estRevenueCents",
      label: "Est. revenue",
      type: "money",
      section: "Summary",
      notNullable: true,
    },
    {
      name: "estCloseDate",
      label: "Est. close date",
      type: "date",
      section: "Summary",
      recommended: true,
    },
    {
      name: "probability",
      label: "Probability %",
      type: "number",
      section: "Summary",
      notNullable: true,
    },
    { name: "budgetCents", label: "Budget", type: "money", section: "Develop" },
    { name: "purchaseTimeframe", label: "Purchase timeframe", type: "text", section: "Develop" },
    {
      name: "proposalDelivered",
      label: "Proposal delivered",
      type: "checkbox",
      section: "Propose",
    },
  ],
};

export const PRODUCT: EntityMeta = {
  key: "product",
  slug: "products",
  singular: "Product",
  plural: "Products",
  numberField: "sku",
  titleFields: ["name"],
  columns: [
    { name: "sku", label: "SKU" },
    { name: "name", label: "Name" },
    { name: "productType", label: "Type", type: "badge" },
    { name: "listPriceCents", label: "List price", type: "money" },
  ],
  views: [{ id: "all", label: "Active Products" }],
  defaultView: "all",
  headerFields: ["productType", "listPriceCents", "standardCostCents"],
  fields: [
    { name: "sku", label: "SKU", type: "text", section: "Summary", required: true },
    { name: "name", label: "Name", type: "text", section: "Summary", required: true },
    {
      name: "productType",
      label: "Type",
      type: "select",
      section: "Summary",
      options: opts(["product", "service"]),
      notNullable: true,
    },
    { name: "description", label: "Description", type: "textarea", section: "Summary" },
    {
      name: "listPriceCents",
      label: "List price",
      type: "money",
      section: "Pricing",
      notNullable: true,
    },
    { name: "standardCostCents", label: "Standard cost", type: "money", section: "Pricing" },
    {
      name: "taxRateId",
      label: "Tax rate",
      type: "select",
      section: "Pricing",
      dynamicOptions: true,
    },
  ],
};

export const ENTITIES: Record<EntityKey, EntityMeta> = {
  product: PRODUCT,
  lead: LEAD,
  account: ACCOUNT,
  contact: CONTACT,
  opportunity: OPPORTUNITY,
};

export const entityBySlug = (slug: string): EntityMeta | undefined =>
  Object.values(ENTITIES).find((e) => e.slug === slug);

export const recordTitle = (meta: EntityMeta, row: Record<string, unknown>): string => {
  const parts = meta.titleFields
    .map((f) => row[f])
    .filter((v): v is string => typeof v === "string" && v !== "");
  return (
    (meta.key === "contact" ? parts.join(" ") : parts[0]) ||
    String(row[meta.numberField] ?? meta.singular)
  );
};
