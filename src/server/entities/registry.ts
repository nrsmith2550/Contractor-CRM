import type { EntityKey } from "@/entities/types";
import {
  createAccount,
  createContact,
  getAccount,
  getContact,
  listAccounts,
  listContacts,
  updateAccount,
  updateContact,
} from "@/server/domain/accounts";
import {
  createProduct,
  getProduct,
  listProducts,
  listTaxRates,
  updateProduct,
} from "@/server/domain/catalog";
import {
  createCase,
  getCase,
  listCases,
  listQueues,
  listSubjects,
  updateCase,
  type CaseView,
} from "@/server/domain/cases";
import type { Ctx, Result } from "@/server/domain/context";
import {
  createWorkOrder,
  getWorkOrder,
  listWorkOrders,
  updateWorkOrder,
  type WoView,
} from "@/server/domain/work-orders";
import type { EntityMeta } from "@/entities/types";
import { createLead, getLead, listLeads, updateLead, type LeadView } from "@/server/domain/leads";
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  updateOpportunity,
  type OpportunityView,
} from "@/server/domain/opportunities";

export type Row = Record<string, unknown> & { id: string };
export type ListOpts = { view?: string; search?: string; limit: number; offset: number };
export type Listed = Result<{ rows: Row[]; total: number }>;
export type Got = Result<{ row: Row }>;

type Ops = {
  list: (ctx: Ctx, o: ListOpts) => Promise<Listed>;
  get: (ctx: Ctx, id: string) => Promise<Got>;
  create: (ctx: Ctx, raw: unknown) => Promise<Got>;
  update: (ctx: Ctx, id: string, raw: unknown) => Promise<Got>;
};

// Adapts each entity's domain functions to one shape so the generic grid, form and actions don't
// care which entity they're handling. All permission and ownership rules live in the domain layer.
const one =
  (field: string) =>
  <T extends object>(r: Result<T>): Got =>
    r.ok ? { ok: true, row: (r as unknown as Record<string, Row>)[field]! } : r;
const many = (r: Result<{ rows: unknown[]; total: number }>): Listed => r as unknown as Listed;

export const OPS: Record<EntityKey, Ops> = {
  case: {
    list: async (ctx, o) =>
      many(await listCases(ctx, { ...o, view: (o.view ?? "my_active") as CaseView })),
    get: async (ctx, id) => one("case")(await getCase(ctx, id)),
    create: async (ctx, raw) => one("case")(await createCase(ctx, raw)),
    update: async (ctx, id, raw) => one("case")(await updateCase(ctx, id, raw)),
  },
  work_order: {
    list: async (ctx, o) =>
      many(await listWorkOrders(ctx, { ...o, view: (o.view ?? "all_open") as WoView })),
    get: async (ctx, id) => one("workOrder")(await getWorkOrder(ctx, id)),
    create: async (ctx, raw) => one("workOrder")(await createWorkOrder(ctx, raw)),
    update: async (ctx, id, raw) => one("workOrder")(await updateWorkOrder(ctx, id, raw)),
  },
  product: {
    list: async (ctx, o) => many(await listProducts(ctx, o)),
    get: async (ctx, id) => one("product")(await getProduct(ctx, id)),
    create: async (ctx, raw) => one("product")(await createProduct(ctx, raw)),
    update: async (ctx, id, raw) => one("product")(await updateProduct(ctx, id, raw)),
  },
  lead: {
    list: async (ctx, o) =>
      many(await listLeads(ctx, { ...o, view: (o.view ?? "my_open") as LeadView })),
    get: async (ctx, id) => one("lead")(await getLead(ctx, id)),
    create: async (ctx, raw) => one("lead")(await createLead(ctx, raw)),
    update: async (ctx, id, raw) => one("lead")(await updateLead(ctx, id, raw)),
  },
  account: {
    list: async (ctx, o) =>
      many(
        await listAccounts(ctx, {
          ...o,
          relationshipType:
            o.view === "customers" ? "customer" : o.view === "prospects" ? "prospect" : undefined,
        }),
      ),
    get: async (ctx, id) => one("account")(await getAccount(ctx, id)),
    create: async (ctx, raw) => one("account")(await createAccount(ctx, raw)),
    update: async (ctx, id, raw) => one("account")(await updateAccount(ctx, id, raw)),
  },
  contact: {
    list: async (ctx, o) => many(await listContacts(ctx, o)),
    get: async (ctx, id) => one("contact")(await getContact(ctx, id)),
    create: async (ctx, raw) => one("contact")(await createContact(ctx, raw)),
    update: async (ctx, id, raw) => one("contact")(await updateContact(ctx, id, raw)),
  },
  opportunity: {
    list: async (ctx, o) =>
      many(await listOpportunities(ctx, { ...o, view: (o.view ?? "my_open") as OpportunityView })),
    get: async (ctx, id) => one("opportunity")(await getOpportunity(ctx, id)),
    create: async (ctx, raw) => one("opportunity")(await createOpportunity(ctx, raw)),
    update: async (ctx, id, raw) => one("opportunity")(await updateOpportunity(ctx, id, raw)),
  },
};

/** Fills in options that come from the database (tax rates for products, subjects and queues for cases). */
export async function withDynamicOptions(ctx: Ctx, meta: EntityMeta): Promise<EntityMeta> {
  const load: Record<string, () => Promise<{ value: string; label: string }[]>> = {};
  if (meta.key === "product") {
    load.taxRateId = async () => {
      const rates = await listTaxRates(ctx);
      return rates.ok
        ? rates.rows.map((r) => ({
            value: r.id,
            label: `${r.name} (${(r.rateBp / 100).toFixed(2)}%)`,
          }))
        : [];
    };
  }
  if (meta.key === "case") {
    load.subjectId = async () => {
      const r = await listSubjects(ctx);
      return r.ok ? r.rows.map((x) => ({ value: x.id, label: x.name })) : [];
    };
    load.queueId = async () => {
      const r = await listQueues(ctx);
      return r.ok ? r.rows.map((x) => ({ value: x.id, label: x.name })) : [];
    };
  }
  if (Object.keys(load).length === 0) return meta;
  const fields = await Promise.all(
    meta.fields.map(async (f) => (load[f.name] ? { ...f, options: await load[f.name]!() } : f)),
  );
  return { ...meta, fields };
}
