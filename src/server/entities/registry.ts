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
import type { Ctx, Result } from "@/server/domain/context";
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
