import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { addActivity, addNote, completeActivity, timeline } from "@/server/domain/activities";
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
import { buildCtx, type Ctx } from "@/server/domain/context";
import { importLeads, suggestMapping } from "@/server/domain/lead-import";
import {
  createLead,
  disqualifyLead,
  getLead,
  listLeads,
  markLeadContacted,
  qualifyLead,
  reactivateLead,
  updateLead,
} from "@/server/domain/leads";
import {
  closeAsLost,
  closeAsWon,
  createOpportunity,
  getOpportunity,
  listOpportunities,
  moveStage,
  openPipelineValue,
  pipeline,
  reopenOpportunity,
  updateOpportunity,
  type OpportunityView,
} from "@/server/domain/opportunities";
import type { Email } from "@/server/email/mailer";
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";
const GHOST = "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11";

async function newBusiness() {
  const { key } = await mintLicense({ tier: "team", seatLimit: 20 });
  const id = rand();
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Sales Co ${id}`,
    ownerName: "Olive Owner",
    ownerEmail: `owner-${id}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return {
    tenantId: res.tenantId,
    ownerId: res.userId,
    admin: await buildCtx(res.tenantId, res.userId),
  };
}
type Biz = Awaited<ReturnType<typeof newBusiness>>;

/** Adds a user with one of the seeded roles, through the real invite and accept flow. */
async function addUser(biz: Biz, roleName: string): Promise<Ctx> {
  const role = (
    await withTenant(biz.tenantId, (tx) =>
      tx.select({ id: securityRole.id }).from(securityRole).where(eq(securityRole.name, roleName)),
    )
  )[0]!.id;
  const mail: Email[] = [];
  const email = `${roleName.replace(/\W/g, "").toLowerCase()}-${rand()}@example.test`;
  await inviteUser(
    { tenantId: biz.tenantId, inviterId: biz.ownerId, email, roleId: role },
    { send: async (e) => void mail.push(e), appUrl: "https://app.test" },
  );
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)![1]!;
  const res = await acceptInvitation({
    token,
    values: { fullName: roleName, password: PASSWORD, confirmPassword: PASSWORD },
    ip: `ip-${rand()}`,
  });
  if (!res.ok) throw new Error(`accept failed: ${res.code}`);
  return buildCtx(biz.tenantId, res.userId);
}

const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

async function mkLead(ctx: Ctx, over: Record<string, unknown> = {}) {
  const id = rand();
  return must(
    await createLead(ctx, {
      firstName: "Jo",
      lastName: "Rivers",
      companyName: `Acme ${id}`,
      email: `jo-${id}@acme.test`,
      phone: "412-555-0100",
      estValueCents: 250_000,
      ...over,
    }),
  ).lead;
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const labelsOf = (r: unknown) =>
  (r as unknown as { missing: { label: string }[] }).missing.map((m) => m.label);
const auditOf = (tenantId: string, recordId: string) =>
  withTenant(tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.recordId, recordId)));

describe.skipIf(!enabled)("Phase 2 acceptance criteria", () => {
  it("Qualify a lead creates Account + Contact + Opportunity linked to the lead, which becomes read-only", async () => {
    const { admin: c } = await newBusiness();
    const l = await mkLead(c, { topic: "Roof wash", jobTitle: "Owner", addressCity: "Pittsburgh" });
    expect(l.leadNumber).toBe("LEAD-01001");
    expect(l.status).toBe("new");

    const q = must(await qualifyLead(c, l.id));
    expect(q.opportunityId).toBeTruthy();

    const account = must(await getAccount(c, q.accountId)).account;
    const contact = must(await getContact(c, q.contactId)).contact;
    const opp = must(await getOpportunity(c, q.opportunityId!)).opportunity;
    const lead = must(await getLead(c, l.id)).lead;

    expect(account).toMatchObject({
      name: l.companyName,
      relationshipType: "prospect",
      accountNumber: "ACC-01001",
      primaryContactId: contact.id,
      addressCity: "Pittsburgh",
    });
    expect(contact).toMatchObject({
      lastName: "Rivers",
      email: l.email,
      jobTitle: "Owner",
      parentAccountId: account.id,
      contactNumber: "CON-01001",
    });
    expect(opp).toMatchObject({
      name: "Roof wash",
      customerAccountId: account.id,
      customerContactId: contact.id,
      originatingLeadId: l.id,
      estRevenueCents: 250_000,
      stage: "qualify",
      status: "open",
      opportunityNumber: "OPP-01001",
    });
    expect(lead).toMatchObject({
      status: "qualified",
      qualifiedAccountId: account.id,
      qualifiedContactId: contact.id,
      qualifiedOpportunityId: opp.id,
    });

    // The lead is now read-only.
    expect(await updateLead(c, l.id, { lastName: "Changed" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await disqualifyLead(c, l.id, "lost")).toMatchObject({ ok: false, code: "read_only" });
    expect(await qualifyLead(c, l.id)).toMatchObject({ ok: false, code: "read_only" });

    // Every created record is in the audit log.
    const log = await withTenant(c.tenantId, (tx) => tx.select().from(auditLog));
    const has = (entity: string, action: string) =>
      log.some((r) => r.entity === entity && r.action === action);
    expect(has("lead", "create") && has("lead", "qualify")).toBe(true);
    expect(
      has("account", "create") && has("contact", "create") && has("opportunity", "create"),
    ).toBe(true);
  });

  it("qualify can skip the opportunity", async () => {
    const { admin: c } = await newBusiness();
    const l = await mkLead(c);
    const q = must(await qualifyLead(c, l.id, { createOpportunity: false }));
    expect(q.opportunityId).toBeNull();
    expect(must(await getLead(c, l.id)).lead.qualifiedOpportunityId).toBeNull();
  });

  it("BPF stage advance enforces required stage fields", async () => {
    const { admin: c } = await newBusiness();
    const opp = must(await createOpportunity(c, { name: "Big deal" })).opportunity;
    expect(opp.stage).toBe("qualify");

    const r1 = await moveStage(c, opp.id, "develop");
    expect(r1).toMatchObject({ ok: false, code: "missing_fields" });
    expect(labelsOf(r1)).toEqual(["Account", "Estimated close date"]);

    const account = must(await createAccount(c, { name: `Buyer ${rand()}` })).account;
    must(
      await updateOpportunity(c, opp.id, {
        customerAccountId: account.id,
        estCloseDate: inDays(30),
      }),
    );
    expect(must(await moveStage(c, opp.id, "develop")).opportunity).toMatchObject({
      stage: "develop",
      probability: 25,
    });

    expect(await moveStage(c, opp.id, "close")).toMatchObject({ ok: false, code: "invalid" }); // no skipping
    const r2 = await moveStage(c, opp.id, "propose");
    expect(r2).toMatchObject({ ok: false, code: "missing_fields" });
    expect(labelsOf(r2)).toEqual(["Decision-maker contact", "Budget", "Purchase timeframe"]);

    const contact = must(
      await createContact(c, { lastName: "Buyer", parentAccountId: account.id }),
    ).contact;
    must(
      await updateOpportunity(c, opp.id, {
        customerContactId: contact.id,
        budgetCents: 500_000,
        purchaseTimeframe: "This quarter",
      }),
    );
    expect(must(await moveStage(c, opp.id, "propose")).opportunity).toMatchObject({
      stage: "propose",
      probability: 50,
    });

    expect(await moveStage(c, opp.id, "close")).toMatchObject({
      ok: false,
      code: "missing_fields",
    });
    must(await updateOpportunity(c, opp.id, { estRevenueCents: 450_000, proposalDelivered: true }));
    expect(must(await moveStage(c, opp.id, "close")).opportunity.stage).toBe("close");

    // Going back is always allowed, and every stage change is audited.
    expect(must(await moveStage(c, opp.id, "develop")).opportunity.stage).toBe("develop");
    expect(await moveStage(c, opp.id, "develop")).toMatchObject({ ok: false, code: "invalid" });
    expect(await moveStage(c, opp.id, "nonsense")).toMatchObject({ ok: false, code: "invalid" });
    expect((await auditOf(c.tenantId, opp.id)).filter((r) => r.action === "stage")).toHaveLength(4);
  });

  it("Closing an opportunity as Won sets the account to Customer", async () => {
    const { admin: c } = await newBusiness();
    const l = await mkLead(c);
    const q = must(await qualifyLead(c, l.id));
    expect(must(await getAccount(c, q.accountId)).account.relationshipType).toBe("prospect");

    expect(await closeAsWon(c, q.opportunityId!, { actualRevenueCents: -1 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const won = must(
      await closeAsWon(c, q.opportunityId!, {
        actualRevenueCents: 300_000,
        competitor: "Rival Inc",
      }),
    );
    expect(won.accountBecameCustomer).toBe(true);
    expect(won.opportunity).toMatchObject({
      status: "won",
      stage: "close",
      probability: 100,
      actualRevenueCents: 300_000,
      competitor: "Rival Inc",
    });
    expect(won.opportunity.actualCloseDate).toBe(new Date().toISOString().slice(0, 10));
    expect(must(await getAccount(c, q.accountId)).account.relationshipType).toBe("customer");

    // A closed opportunity is read-only until reopened.
    expect(await updateOpportunity(c, q.opportunityId!, { name: "x" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await moveStage(c, q.opportunityId!, "develop")).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await closeAsLost(c, q.opportunityId!, { reason: "Changed mind" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(must(await reopenOpportunity(c, q.opportunityId!)).opportunity.status).toBe("open");

    // A second win on an account that's already a customer doesn't flip it again.
    const second = must(
      await createOpportunity(c, { name: "Repeat", customerAccountId: q.accountId }),
    );
    expect(
      must(await closeAsWon(c, second.opportunity.id, { actualRevenueCents: 1 }))
        .accountBecameCustomer,
    ).toBe(false);
  });

  it("A salesperson with User-level read cannot open another user's lead", async () => {
    const biz = await newBusiness();
    const a = await addUser(biz, "Salesperson");
    const b = await addUser(biz, "Salesperson");
    const leadA = await mkLead(a, { topic: "A's secret lead" });

    expect(must(await getLead(a, leadA.id)).lead.id).toBe(leadA.id);
    const denied = await getLead(b, leadA.id);
    expect(denied).toMatchObject({ ok: false, code: "not_found" }); // existence isn't revealed
    expect(JSON.stringify(denied)).not.toContain("secret");

    // Lists only ever contain their own records, whatever the view or search.
    for (const view of ["my_open", "all_open", "this_week", "disqualified"] as const) {
      expect(must(await listLeads(b, { view })).rows).toEqual([]);
    }
    expect(must(await listLeads(b, { view: "all_open", search: "secret" })).total).toBe(0);
    expect(must(await listLeads(a, { view: "all_open" })).rows.map((r) => r.id)).toEqual([
      leadA.id,
    ]);

    // And they can't change, qualify, annotate or read the timeline of it either.
    expect(await updateLead(b, leadA.id, { lastName: "Hacked" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(await qualifyLead(b, leadA.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await disqualifyLead(b, leadA.id, "lost")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await addNote(b, { regardingType: "lead", regardingId: leadA.id, body: "hi" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await timeline(b, "lead", leadA.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await getLead(a, leadA.id)).lead.lastName).toBe("Rivers");

    // Organization depth (the owner is a System Administrator) sees everything.
    expect(must(await getLead(biz.admin, leadA.id)).lead.id).toBe(leadA.id);
    expect(must(await listLeads(biz.admin, { view: "all_open" })).rows.map((r) => r.id)).toContain(
      leadA.id,
    );
  });
});

describe.skipIf(!enabled)("Leads", () => {
  it("numbers records sequentially and uniquely even when created concurrently", async () => {
    const { admin: c } = await newBusiness();
    const leads = await Promise.all(Array.from({ length: 12 }, () => mkLead(c)));
    const numbers = leads.map((l) => l.leadNumber).sort();
    expect(new Set(numbers).size).toBe(12);
    expect(numbers[0]).toBe("LEAD-01001");
    expect(numbers.at(-1)).toBe("LEAD-01012");
  });

  it("validates input, defaults the topic and normalises the email", async () => {
    const { admin: c } = await newBusiness();
    expect(await createLead(c, { firstName: "No last name" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createLead(c, { lastName: "X", email: "nope" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createLead(c, { lastName: "X", rating: "lukewarm" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createLead(c, { lastName: "X", estValueCents: -5 })).toMatchObject({
      ok: false,
      code: "invalid",
    });

    const l = must(
      await createLead(c, {
        firstName: " Ada ",
        lastName: "Lovelace",
        email: " ADA@Example.TEST ",
        companyName: "Analytical Engines",
        leadSource: "web",
        rating: "hot",
      }),
    ).lead;
    expect(l).toMatchObject({
      email: "ada@example.test",
      firstName: "Ada",
      topic: "Analytical Engines — Lovelace",
      leadSource: "web",
      rating: "hot",
      status: "new",
    });
    const bare = must(
      await createLead(c, { firstName: "Grace", lastName: "Hopper", email: "" }),
    ).lead;
    expect(bare).toMatchObject({ topic: "Grace Hopper", email: null });
  });

  it("updates with a field-level audit trail; fields can be cleared but the topic is required", async () => {
    const { admin: c } = await newBusiness();
    const l = await mkLead(c, { jobTitle: "Manager" });
    const up = must(await updateLead(c, l.id, { jobTitle: "Director", phone: "" }));
    expect(up.lead).toMatchObject({ jobTitle: "Director", phone: null });
    expect(await updateLead(c, l.id, { topic: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await updateLead(c, l.id, { lastName: "" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    must(await updateLead(c, l.id, { jobTitle: "Director" })); // a no-op writes no audit row

    const updates = (await auditOf(c.tenantId, l.id)).filter((r) => r.action === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toEqual({
      jobTitle: { from: "Manager", to: "Director" },
      phone: { from: "412-555-0100", to: null },
    });
  });

  it("marks contacted, disqualifies with a reason (read-only), and reactivates", async () => {
    const { admin: c } = await newBusiness();
    const l = await mkLead(c);
    expect(must(await markLeadContacted(c, l.id)).lead.status).toBe("contacted");
    expect(await markLeadContacted(c, l.id)).toMatchObject({ ok: false, code: "conflict" });

    expect(await disqualifyLead(c, l.id, "because")).toMatchObject({ ok: false, code: "invalid" });
    const dq = must(await disqualifyLead(c, l.id, "cannot_contact")).lead;
    expect(dq).toMatchObject({ status: "disqualified", disqualifyReason: "cannot_contact" });
    expect(await updateLead(c, l.id, { lastName: "Nope" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(await qualifyLead(c, l.id)).toMatchObject({ ok: false, code: "read_only" });
    expect(await disqualifyLead(c, l.id, "lost")).toMatchObject({ ok: false, code: "conflict" });

    expect(must(await reactivateLead(c, l.id)).lead).toMatchObject({
      status: "new",
      disqualifyReason: null,
    });
    expect(await reactivateLead(c, l.id)).toMatchObject({ ok: false, code: "conflict" });
    expect(must(await updateLead(c, l.id, { lastName: "Editable again" })).lead.lastName).toBe(
      "Editable again",
    );
  });

  it("offers the four system views and searches", async () => {
    const biz = await newBusiness();
    const owner = biz.admin;
    const other = await addUser(biz, "Sales Manager");
    const mine = await mkLead(owner, { topic: "Needle in haystack", companyName: "Zebra Zinc" });
    const theirs = await mkLead(other, { lastName: "Theirs" });
    const dq = await mkLead(owner);
    must(await disqualifyLead(owner, dq.id, "lost"));

    const ids = async (c: Ctx, o: Parameters<typeof listLeads>[1]) =>
      must(await listLeads(c, o)).rows.map((r) => r.id);
    expect(await ids(owner, { view: "my_open" })).toEqual([mine.id]);
    expect((await ids(owner, { view: "all_open" })).sort()).toEqual([mine.id, theirs.id].sort());
    expect(await ids(owner, { view: "disqualified" })).toEqual([dq.id]);
    expect(await ids(owner, { view: "this_week" })).toHaveLength(3);
    expect(await ids(owner, { view: "all_open", search: "zebra" })).toEqual([mine.id]);
    expect(await ids(owner, { view: "all_open", search: mine.leadNumber })).toEqual([mine.id]);
    expect(must(await listLeads(owner, { view: "all_open", limit: 1 })).total).toBe(2);
    expect(must(await listLeads(owner, { view: "all_open", limit: 1 })).rows).toHaveLength(1);
  });
});

describe.skipIf(!enabled)("Duplicate detection when qualifying", () => {
  it("stops and returns matches (by name, email or phone) instead of silently creating duplicates", async () => {
    const { admin: c } = await newBusiness();
    const existingAccount = must(
      await createAccount(c, { name: "Acme, Inc.", phone: "+1 (412) 555-0100" }),
    ).account;
    const existingContact = must(
      await createContact(c, {
        lastName: "Rivers",
        email: "JO@acme.test",
        parentAccountId: existingAccount.id,
      }),
    ).contact;

    // Same company name (different punctuation/case) and same email.
    const l = await mkLead(c, { companyName: "ACME inc", email: "jo@acme.test", phone: "000" });
    const r = await qualifyLead(c, l.id);
    expect(r).toMatchObject({ ok: false, code: "duplicates" });
    const dups = (
      r as unknown as { duplicates: { kind: string; id: string; matchedOn: string[] }[] }
    ).duplicates;
    expect(dups.find((d) => d.kind === "account")).toMatchObject({
      id: existingAccount.id,
      matchedOn: ["name"],
    });
    expect(dups.find((d) => d.kind === "contact")).toMatchObject({
      id: existingContact.id,
      matchedOn: ["email"],
    });
    // Nothing was created and the lead is untouched.
    expect(must(await listAccounts(c)).total).toBe(1);
    expect(must(await getLead(c, l.id)).lead.status).toBe("new");

    // Phone digits match regardless of formatting.
    const byPhone = await mkLead(c, {
      companyName: "Different Co",
      email: `x-${rand()}@x.test`,
      phone: "412.555.0100",
    });
    const rp = await qualifyLead(c, byPhone.id);
    expect(rp).toMatchObject({ ok: false, code: "duplicates" });
    expect(
      (rp as unknown as { duplicates: { matchedOn: string[] }[] }).duplicates[0]!.matchedOn,
    ).toContain("phone");
  });

  it("reuses a chosen existing account/contact, or creates new ones when told to", async () => {
    const { admin: c } = await newBusiness();
    const acct = must(await createAccount(c, { name: "Globex" })).account;
    const cont = must(
      await createContact(c, { lastName: "Smith", email: "smith@globex.test" }),
    ).contact;

    const l1 = await mkLead(c, { companyName: "Globex", email: "smith@globex.test" });
    const reuse = must(await qualifyLead(c, l1.id, { account: acct.id, contact: cont.id }));
    expect(reuse).toMatchObject({ accountId: acct.id, contactId: cont.id });
    expect(must(await listAccounts(c)).total).toBe(1);
    expect(must(await getOpportunity(c, reuse.opportunityId!)).opportunity.customerAccountId).toBe(
      acct.id,
    );

    const l2 = await mkLead(c, { companyName: "Globex", email: "smith@globex.test" });
    const fresh = must(await qualifyLead(c, l2.id, { account: "new", contact: "new" }));
    expect(fresh.accountId).not.toBe(acct.id);
    expect(must(await listAccounts(c)).total).toBe(2);

    const l3 = await mkLead(c);
    expect(await qualifyLead(c, l3.id, { account: GHOST })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await qualifyLead(c, l3.id, { account: "not-a-uuid" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
  });
});

describe.skipIf(!enabled)("Opportunities", () => {
  it("close as lost needs a reason, drops the probability to 0, and can be reopened", async () => {
    const { admin: c } = await newBusiness();
    const opp = must(
      await createOpportunity(c, { name: "Maybe", estRevenueCents: 100_000 }),
    ).opportunity;
    expect(await closeAsLost(c, opp.id, { reason: "  " })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const lost = must(
      await closeAsLost(c, opp.id, { reason: "Price", competitor: "Rival" }),
    ).opportunity;
    expect(lost).toMatchObject({
      status: "lost",
      probability: 0,
      closeReason: "Price",
      competitor: "Rival",
    });
    expect(await updateOpportunity(c, opp.id, { name: "x" })).toMatchObject({
      ok: false,
      code: "read_only",
    });
    expect(must(await reopenOpportunity(c, opp.id)).opportunity).toMatchObject({
      status: "open",
      probability: 10,
    });
    expect(await reopenOpportunity(c, opp.id)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("validates fields; money stays in integer cents", async () => {
    const { admin: c } = await newBusiness();
    expect(await createOpportunity(c, { name: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createOpportunity(c, { name: "x", estCloseDate: "next week" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createOpportunity(c, { name: "x", estRevenueCents: 10.5 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await createOpportunity(c, { name: "x", probability: 101 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      must(await createOpportunity(c, { name: "x", estRevenueCents: 199_999_999 })).opportunity
        .estRevenueCents,
    ).toBe(199_999_999);
  });

  it("offers the views, the pipeline board and the pipeline value", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const mk = async (over: Record<string, unknown>) =>
      must(await createOpportunity(c, { name: `Opp ${rand()}`, ...over })).opportunity;
    const soon = await mk({ estCloseDate: inDays(10), estRevenueCents: 100_00 });
    const later = await mk({ estCloseDate: inDays(90), estRevenueCents: 200_00 });
    const won = await mk({ estRevenueCents: 50_00 });
    const lost = await mk({});
    must(await closeAsWon(c, won.id, { actualRevenueCents: 50_00 }));
    must(await closeAsLost(c, lost.id, { reason: "Nope" }));

    const ids = async (view: OpportunityView) =>
      must(await listOpportunities(c, { view }))
        .rows.map((r) => r.id)
        .sort();
    expect(await ids("open")).toEqual([soon.id, later.id].sort());
    expect(await ids("my_open")).toEqual([soon.id, later.id].sort());
    expect(await ids("closing_30")).toEqual([soon.id]);
    expect(await ids("won")).toEqual([won.id]);
    expect(await ids("lost")).toEqual([lost.id]);

    const board = must(await pipeline(c));
    expect(board.stages.map((s) => s.stage)).toEqual(["qualify", "develop", "propose", "close"]);
    expect(board.stages[0]).toMatchObject({ count: 2, estRevenueCents: 300_00 });
    expect(board.stages[1]!.count).toBe(0);
    expect(await openPipelineValue(c)).toBe(300_00);
  });

  it("a salesperson sees only their own opportunities and pipeline", async () => {
    const biz = await newBusiness();
    const a = await addUser(biz, "Salesperson");
    const b = await addUser(biz, "Salesperson");
    const oppA = must(
      await createOpportunity(a, { name: "A's deal", estRevenueCents: 700_00 }),
    ).opportunity;
    expect(await getOpportunity(b, oppA.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await listOpportunities(b, { view: "open" })).rows).toEqual([]);
    expect(must(await pipeline(b)).stages.every((s) => s.count === 0)).toBe(true);
    expect(await openPipelineValue(b)).toBe(0);
    expect(await moveStage(b, oppA.id, "develop")).toMatchObject({ ok: false, code: "not_found" });
    expect(await closeAsWon(b, oppA.id, { actualRevenueCents: 1 })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(must(await pipeline(a)).stages[0]!.count).toBe(1);
    expect(await openPipelineValue(biz.admin)).toBe(700_00);
  });
});

describe.skipIf(!enabled)("Accounts, contacts and role permissions", () => {
  it("creates, updates (with audit) and searches accounts and contacts", async () => {
    const { admin: c } = await newBusiness();
    const parent = must(
      await createAccount(c, { name: "Parent Corp", relationshipType: "partner" }),
    ).account;
    const child = must(
      await createAccount(c, {
        name: "Child LLC",
        parentAccountId: parent.id,
        website: "https://child.test",
      }),
    ).account;
    expect(child.accountNumber).toBe("ACC-01002");
    expect(await createAccount(c, { name: "" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await createAccount(c, { name: "x", relationshipType: "enemy" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await updateAccount(c, parent.id, { parentAccountId: parent.id })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      must(await updateAccount(c, parent.id, { relationshipType: "vendor" })).account
        .relationshipType,
    ).toBe("vendor");

    expect(must(await listAccounts(c, { search: "child" })).rows.map((r) => r.id)).toEqual([
      child.id,
    ]);
    expect(
      must(await listAccounts(c, { relationshipType: "vendor" })).rows.map((r) => r.id),
    ).toEqual([parent.id]);

    const k = must(
      await createContact(c, {
        firstName: "Kim",
        lastName: "Lee",
        email: "KIM@x.test",
        parentAccountId: child.id,
      }),
    ).contact;
    expect(k).toMatchObject({ contactNumber: "CON-01001", email: "kim@x.test" });
    expect(await createContact(c, { lastName: "X", email: "bad" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(must(await updateContact(c, k.id, { jobTitle: "CTO" })).contact.jobTitle).toBe("CTO");
    expect(must(await listContacts(c, { accountId: child.id })).rows.map((r) => r.id)).toEqual([
      k.id,
    ]);
    expect(must(await listContacts(c, { search: "lee" })).total).toBe(1);

    const log = await auditOf(c.tenantId, parent.id);
    expect(log.find((r) => r.action === "update")!.changes).toEqual({
      relationshipType: { from: "partner", to: "vendor" },
    });
  });

  it("applies each seeded role's privileges", async () => {
    const biz = await newBusiness();
    const tech = await addUser(biz, "Field Technician");
    const readOnly = await addUser(biz, "Read-only");
    const csr = await addUser(biz, "Customer Service Rep");
    const lead = await mkLead(biz.admin);
    const acct = must(await createAccount(biz.admin, { name: `Shared ${rand()}` })).account;

    // Field Technician has no lead access at all.
    expect(await listLeads(tech)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await getLead(tech, lead.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await createLead(tech, { lastName: "X" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await createAccount(tech, { name: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(must(await getAccount(tech, acct.id)).account.id).toBe(acct.id); // read-only on accounts

    // Read-only can read everything but change nothing ("forbidden", not "not found").
    expect(must(await getLead(readOnly, lead.id)).lead.id).toBe(lead.id);
    expect(await updateLead(readOnly, lead.id, { lastName: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await updateAccount(readOnly, acct.id, { name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await createOpportunity(readOnly, { name: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(must(await listLeads(readOnly, { view: "all_open" })).total).toBe(1);

    // A service rep manages accounts but has no sales access.
    expect(must(await updateAccount(csr, acct.id, { phone: "555" })).account.phone).toBe("555");
    expect(await listLeads(csr)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await createOpportunity(csr, { name: "x" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });
});

describe.skipIf(!enabled)("Notes, activities and the timeline", () => {
  it("builds a newest-first timeline of notes and activities on a record", async () => {
    const { admin: c } = await newBusiness();
    const l = await mkLead(c);
    const note = must(
      await addNote(c, {
        regardingType: "lead",
        regardingId: l.id,
        title: "Call recap",
        body: "Wants a quote",
      }),
    ).note;
    const task = must(
      await addActivity(c, {
        activityType: "task",
        subject: "Send quote",
        regardingType: "lead",
        regardingId: l.id,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        priority: "high",
      }),
    ).activity;
    const call = must(
      await addActivity(c, {
        activityType: "phone_call",
        subject: "Follow up",
        direction: "outgoing",
        regardingType: "lead",
        regardingId: l.id,
      }),
    ).activity;

    const t = must(await timeline(c, "lead", l.id));
    expect(t.items).toHaveLength(3);
    const times = t.items.map((i) => i.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(t.items.map((i) => (i.kind === "note" ? i.note.id : i.activity.id)).sort()).toEqual(
      [note.id, task.id, call.id].sort(),
    );

    expect(must(await completeActivity(c, task.id)).activity.status).toBe("completed");
    expect(await completeActivity(c, task.id)).toMatchObject({ ok: false, code: "conflict" });
  });

  it("validates input and only attaches to records the user can see", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const l = await mkLead(c);
    expect(
      await addNote(c, { regardingType: "lead", regardingId: l.id, body: "  " }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await addNote(c, { regardingType: "invoice", regardingId: l.id, body: "x" }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await addNote(c, { regardingType: "lead", regardingId: GHOST, body: "x" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await addActivity(c, { activityType: "task", subject: "x", regardingType: "lead" }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(await addActivity(c, { activityType: "fax", subject: "x" })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    // A standalone task (not regarding anything) is fine.
    expect(
      must(await addActivity(c, { activityType: "task", subject: "Standalone" })).activity
        .regardingId,
    ).toBeNull();
  });
});

describe.skipIf(!enabled)("CSV lead import", () => {
  it("imports rows through the normal create path and reports bad rows by row number", async () => {
    const { admin: c } = await newBusiness();
    const csv = [
      "First Name,Last Name,Company,E-mail,Phone,Lead Source,Estimated Value,City",
      'Ada,Lovelace,"Analytical, Engines",ada@ae.test,412-555-0001,Web,"$12,500.50",London',
      "Grace,Hopper,Navy,grace@navy.test,412-555-0002,Trade Show,,Arlington",
      ",,Missing last name Co,x@x.test,,,,",
      "Bad,Email,Co,not-an-email,,,,",
      "Money,Trouble,Co,m@t.test,,,twelve,",
      "Alan,Turing,Bletchley,alan@bp.test,,Referral,300,",
    ].join("\n");
    const mapping = suggestMapping(csv.split("\n")[0]!.split(","));
    expect(mapping.lastName).toBe(1);

    const res = must(await importLeads(c, csv, mapping));
    expect(res.report).toMatchObject({ total: 6, created: 3 });
    expect(res.report.errors.map((e) => e.row)).toEqual([4, 5, 6]); // spreadsheet rows; header is row 1
    expect(res.report.errors[1]!.message).toMatch(/email/i);
    expect(res.report.errors[2]!.message).toMatch(/amount/i);

    const all = must(await listLeads(c, { view: "all_open" })).rows;
    expect(all).toHaveLength(3);
    expect(all.find((l) => l.lastName === "Lovelace")).toMatchObject({
      companyName: "Analytical, Engines",
      estValueCents: 1_250_050,
      leadSource: "web",
      addressCity: "London",
      status: "new",
    });
    expect(all.find((l) => l.lastName === "Hopper")).toMatchObject({
      leadSource: "trade_show",
      estValueCents: null,
    });
    expect(all.find((l) => l.lastName === "Turing")!.estValueCents).toBe(30_000);
    expect(all.map((l) => l.leadNumber).sort()).toEqual(["LEAD-01001", "LEAD-01002", "LEAD-01003"]);
  });

  it("requires a last-name mapping, rejects malformed CSV, and respects create permission", async () => {
    const biz = await newBusiness();
    expect(await importLeads(biz.admin, "a,b\n1,2", { firstName: 0 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await importLeads(biz.admin, 'a,"b\n1', { lastName: 0 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    const tech = await addUser(biz, "Field Technician");
    expect(await importLeads(tech, "Last\nRivers", { lastName: 0 })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const noHeader = must(
      await importLeads(biz.admin, "Rivers\nStone", { lastName: 0 }, { hasHeader: false }),
    );
    expect(noHeader.report).toMatchObject({ total: 2, created: 2 });
  });
});

describe.skipIf(!enabled)("Tenant isolation", () => {
  it("another business can't read or touch these records, and numbering is per business", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const leadA = await mkLead(a.admin);
    const leadB = await mkLead(b.admin);
    expect(leadA.leadNumber).toBe("LEAD-01001");
    expect(leadB.leadNumber).toBe("LEAD-01001"); // independent sequences

    // B's (even most-privileged) user can't see A's lead by id, in lists, or change it.
    expect(await getLead(b.admin, leadA.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await listLeads(b.admin, { view: "all_open" })).rows.map((r) => r.id)).toEqual([
      leadB.id,
    ]);
    expect(await updateLead(b.admin, leadA.id, { lastName: "Hacked" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await addNote(b.admin, { regardingType: "lead", regardingId: leadA.id, body: "x" }),
    ).toMatchObject({ ok: false, code: "not_found" });

    const q = must(await qualifyLead(a.admin, leadA.id));
    expect(await getAccount(b.admin, q.accountId)).toMatchObject({ ok: false, code: "not_found" });
    expect(await closeAsWon(b.admin, q.opportunityId!, { actualRevenueCents: 1 })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(must(await getLead(a.admin, leadA.id)).lead.lastName).toBe("Rivers");
  });
});
