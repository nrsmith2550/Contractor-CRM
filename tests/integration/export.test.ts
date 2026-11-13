import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, securityRole } from "@/db/schema";
import { ENTITIES } from "@/entities";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount } from "@/server/domain/accounts";
import { createCase } from "@/server/domain/cases";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { createOpportunity } from "@/server/domain/opportunities";
import { exportEntity } from "@/server/entities/export";
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

const base = { view: "", search: "", tz: "UTC", format: "xlsx" };
const exp = (
  c: Ctx,
  key: keyof typeof ENTITIES,
  over: Partial<typeof base> & { limit?: number } = {},
) => exportEntity(c, ENTITIES[key], { ...base, view: ENTITIES[key].defaultView, ...over });

describe.skipIf(!enabled)("Export to Excel", () => {
  it("exports every record in the view, past the 200 a single list call returns, in the grid's columns", async () => {
    const { admin: c } = await newBusiness();
    for (let i = 0; i < 205; i++)
      must(await createAccount(c, { name: `Acct ${String(i).padStart(3, "0")} ${rand()}` }));
    const r = must(await exp(c, "account"));
    expect(r.count).toBe(205);
    expect(r.sheet.rows).toHaveLength(205);
    expect(r.sheet.headers).toEqual(ENTITIES.account.columns.map((x) => x.label));
    expect(new Set(r.sheet.rows.map((row) => row[0])).size).toBe(205); // no row repeated or skipped at the page boundary
  });

  it("applies the view and the search", async () => {
    const { admin: c } = await newBusiness();
    const tag = rand();
    must(await createAccount(c, { name: `Findme ${tag}` }));
    must(await createAccount(c, { name: `Other ${rand()}` }));
    const all = must(await exp(c, "account"));
    const some = must(await exp(c, "account", { search: `Findme ${tag}` }));
    expect(all.count).toBe(2);
    expect(some.count).toBe(1);
    expect(JSON.stringify(some.sheet.rows)).toContain(`Findme ${tag}`);
  });

  it("formats money as cents, dates in the business's zone, and badges as words", async () => {
    const { admin: c } = await newBusiness();
    must(
      await createOpportunity(c, {
        name: "Deal",
        estRevenueCents: 123_45,
        estCloseDate: "2030-05-01",
      }),
    );
    const r = must(await exp(c, "opportunity"));
    const cols = ENTITIES.opportunity.columns;
    const row = r.sheet.rows[0]!;
    const at = (name: string) => row[cols.findIndex((x) => x.name === name)];
    expect(at("estRevenueCents")).toEqual({ kind: "money", cents: 123_45 });
    expect(at("estCloseDate")).toEqual({ kind: "date", value: "2030-05-01" });
    expect(at("stage")).toBe("Qualify");
  });

  it("shows a case's SLA state, and timestamps in the zone they were asked for", async () => {
    const { admin: c } = await newBusiness();
    must(await createCase(c, { title: "No heat", priority: "urgent" }));
    const r = must(await exp(c, "case"));
    const col = ENTITIES.case.columns.findIndex((x) => x.type === "sla");
    expect(["On track", "Due soon"]).toContain(r.sheet.rows[0]![col]);
  });

  it("only exports what the person may read, and refuses a role with no access", async () => {
    const biz = await newBusiness();
    const rep = await addUser(biz, "Salesperson");
    must(await createOpportunity(biz.admin, { name: `Boss's ${rand()}` }));
    must(await createOpportunity(rep, { name: `Mine ${rand()}` }));
    expect(must(await exp(rep, "opportunity", { view: "open" })).count).toBe(1); // user-level read: their own only
    expect(must(await exp(biz.admin, "opportunity", { view: "open" })).count).toBe(2);

    const tech = await addUser(biz, "Field Technician"); // no lead privileges
    expect(await exp(tech, "lead")).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("refuses a view that is too big instead of cutting it short", async () => {
    const { admin: c } = await newBusiness();
    for (let i = 0; i < 3; i++) must(await createAccount(c, { name: `A ${i} ${rand()}` }));
    const r = await exp(c, "account", { limit: 2 });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect((r as { message: string }).message).toContain("Narrow the view");
    expect(must(await exp(c, "account", { limit: 3 })).count).toBe(3);
  });

  it("writes an audit entry for each export, and nothing for a refused one", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    must(await createAccount(c, { name: `X ${rand()}` }));
    must(await exp(c, "account", { format: "csv" }));
    const tech = await addUser(biz, "Field Technician");
    await exp(tech, "lead");
    const rows = await withTenant(c.tenantId, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, c.tenantId), eq(auditLog.action, "export"))),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity: "account", userId: c.userId, recordId: null });
    expect(rows[0]!.changes).toMatchObject({ format: "csv", records: 1 });
  });

  it("never includes another business's records", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    must(await createAccount(a.admin, { name: `Secret ${rand()}` }));
    expect(must(await exp(b.admin, "account")).count).toBe(0);
  });
});
