/**
 * Dynamics-style security roles, simplified. Privileges are per entity and action, each at a
 * depth: "user" (only records the user owns) or "organization" (all records in the tenant).
 * A missing entry means no access. Stored as JSON on `security_role.privileges`.
 */
export const ENTITIES = [
  "lead",
  "account",
  "contact",
  "opportunity",
  "quote",
  "order",
  "case",
  "work_order",
  "booking",
  "product",
  "price_list",
  "activity",
  "note",
  "dashboard",
  "user",
  "security_role",
  "license",
] as const;
export const ACTIONS = ["create", "read", "write", "delete", "assign"] as const;

export type Entity = (typeof ENTITIES)[number];
export type Action = (typeof ACTIONS)[number];
export type Depth = "user" | "organization";
export type Privileges = Partial<Record<Entity, Partial<Record<Action, Depth>>>>;

const RANK: Record<Depth, number> = { user: 1, organization: 2 };

/** Combines several roles: for each entity/action the deepest grant wins. */
export function mergePrivileges(roles: Privileges[]): Privileges {
  const out: Privileges = {};
  for (const role of roles) {
    for (const entity of Object.keys(role) as Entity[]) {
      for (const action of Object.keys(role[entity] ?? {}) as Action[]) {
        const depth = role[entity]![action]!;
        const current = (out[entity] ??= {})[action];
        if (!current || RANK[depth] > RANK[current]) out[entity]![action] = depth;
      }
    }
  }
  return out;
}

export type Subject = { userId: string; privileges: Privileges };

/**
 * The single permission check. Without `record` it answers "may this user ever do this?"
 * (use it to show or hide a button or guard a list). With `record` it enforces depth:
 * a user-level grant only covers records whose `ownerId` is the user. `create` has no
 * record to own, so any grant is enough.
 */
export function can(
  subject: Subject,
  entity: Entity,
  action: Action,
  record?: { ownerId?: string | null },
): boolean {
  const depth = subject.privileges[entity]?.[action];
  if (!depth) return false;
  if (depth === "organization" || action === "create" || record === undefined) return true;
  return record.ownerId === subject.userId;
}

function grant(entities: Entity[], actions: Action[], depth: Depth): Privileges {
  const p: Privileges = {};
  for (const e of entities) {
    p[e] = {};
    for (const a of actions) p[e]![a] = depth;
  }
  return p;
}

const merge = (...parts: Privileges[]) => mergePrivileges(parts);
const ALL: Action[] = [...ACTIONS];
const SALES: Entity[] = ["lead", "account", "contact", "opportunity", "quote", "order"];
const SERVICE: Entity[] = ["case", "work_order", "booking"];
const COMMON: Entity[] = ["activity", "note", "dashboard"];

export const DEFAULT_ROLES: { name: string; privileges: Privileges }[] = [
  { name: "System Administrator", privileges: grant([...ENTITIES], ALL, "organization") },
  {
    name: "Sales Manager",
    privileges: merge(
      grant([...SALES, "product", "price_list", ...COMMON], ALL, "organization"),
      grant([...SERVICE], ["read"], "organization"),
    ),
  },
  {
    name: "Salesperson",
    privileges: merge(
      // Own records only for leads, opportunities, quotes and orders.
      grant(
        ["lead", "opportunity", "quote", "order"],
        ["create", "read", "write", "delete"],
        "user",
      ),
      grant(["account", "contact"], ["create", "read", "write"], "organization"),
      grant(["product", "price_list"], ["read"], "organization"),
      grant([...COMMON], ["create", "read", "write"], "user"),
    ),
  },
  {
    name: "Customer Service Rep",
    privileges: merge(
      grant(["case", "work_order", "booking"], ["create", "read", "write"], "organization"),
      grant(["account", "contact"], ["read", "write"], "organization"),
      grant([...COMMON], ["create", "read", "write"], "user"),
    ),
  },
  {
    name: "Field Technician",
    privileges: merge(
      grant(["work_order"], ["read"], "organization"),
      grant(["booking"], ["read", "write"], "user"),
      grant(["account", "contact"], ["read"], "organization"),
      grant(["note", "activity"], ["create", "read", "write"], "user"),
    ),
  },
  {
    name: "Read-only",
    privileges: grant(
      ENTITIES.filter((e) => e !== "license"),
      ["read"],
      "organization",
    ),
  },
];

export const OWNER_ROLE_NAME = "System Administrator";
