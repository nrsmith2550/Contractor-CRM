// Entity metadata. Each entity is described once as plain data (fields, list columns, views,
// header fields) and the generic EntityGrid / EntityForm render from it, the way Dynamics works:
// adding a field or a view is a metadata change, not a new page. Plain data only, so it can be
// passed from server components to client components.

export type EntityKey = "lead" | "account" | "contact" | "opportunity" | "product";

export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "textarea"
  | "select"
  | "money" // entered in dollars, stored as integer cents
  | "date"
  | "number"
  | "checkbox"
  | "lookup";

export type Option = { value: string; label: string };

export type FieldDef = {
  /** Same name as the domain input and the table column. */
  name: string;
  label: string;
  type: FieldType;
  section: string;
  required?: boolean;
  /** "Business recommended": shown with a blue plus. */
  recommended?: boolean;
  options?: Option[];
  /** Options are loaded from the database when the page renders (see withDynamicOptions). */
  dynamicOptions?: boolean;
  lookup?: "account" | "contact";
  /** The domain rejects null for this field, so a blank is omitted rather than sent. */
  notNullable?: boolean;
  hint?: string;
};

export type ColumnDef = {
  name: string;
  label: string;
  type?: "text" | "money" | "date" | "badge";
};

export type EntityMeta = {
  key: EntityKey;
  slug: string;
  singular: string;
  plural: string;
  numberField: string;
  /** The first non-empty of these, joined, is the record's title. */
  titleFields: string[];
  columns: ColumnDef[];
  views: { id: string; label: string }[];
  defaultView: string;
  fields: FieldDef[];
  /** Up to four key fields shown in the form header. */
  headerFields: string[];
};
