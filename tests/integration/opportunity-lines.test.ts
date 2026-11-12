import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createProduct, createTaxRate } from "@/server/domain/catalog";
import { buildCtx, type Ctx } from "@/server/domain/context";
import {
  closeAsWon,
  createOpportunity,
  getOpportunity,
  reopenOpportunity,
  updateOpportunity,
} from "@/server/domain/opportunities";
import {
  addOpportunityLine,
  listOpportunityLines,
  removeOpportunityLine,
} from "@/server/domain/opportunity-lines";
import { addLine, createQuote, getQuote } from "@/server/domain/quotes";
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

async function opp(c: Ctx, over: Record<string, unknown> = {}) {
  return must(await createOpportunity(c, { name: "Fence job", ...over })).opportunity;
}
const est = async (c: Ctx, id: string) =>
  must(await getOpportunity(c, id)).opportunity.estRevenueCents;

describe.skipIf(!enabled)("Opportunity product lines", () => {
  it("calculates the estimated revenue from the lines, to the cent, and audits it", async () => {
    const { admin: c } = await newBusiness();
    const widget = must(
      await createProduct(c, { sku: `W-${rand()}`, name: "Widget", listPriceCents: 1999 }),
    ).product;
    const o = await opp(c, { estRevenueCents: 12345 });
    expect(await est(c, o.id)).toBe(12345); // typed by hand while there are no lines

    const a = must(await addOpportunityLine(c, o.id, { productId: widget.id, quantity: 3 }));
    expect(a.line).toMatchObject({
      lineNumber: 1,
      description: "Widget",
      unitPriceCents: 1999,
      extendedCents: 5997,
    });
    expect(a.estRevenueCents).toBe(5997);
    const b = must(
      await addOpportunityLine(c, o.id, {
        description: "Install",
        quantity: 2.5,
        unitPriceCents: 4000,
        discountCents: 1000,
      }),
    );
    expect(b.line).toMatchObject({ lineNumber: 2, quantityMilli: 2500, extendedCents: 9000 });
    expect(await est(c, o.id)).toBe(5997 + 9000);

    const audit = await withTenant(c.tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.recordId, o.id)),
    );
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["add_product", "update"]));
    expect(audit.some((x) => JSON.stringify(x.changes).includes("calculatedFromLines"))).toBe(true);
  });

  it("ignores a typed-in revenue while lines exist, and lets you edit it again once they're gone", async () => {
    const { admin: c } = await newBusiness();
    const o = await opp(c);
    const l = must(
      await addOpportunityLine(c, o.id, {
        description: "Thing",
        quantity: 1,
        unitPriceCents: 5000,
      }),
    ).line;
    must(await updateOpportunity(c, o.id, { name: "Renamed", estRevenueCents: 99_999_00 }));
    const after = must(await getOpportunity(c, o.id)).opportunity;
    expect(after.name).toBe("Renamed");
    expect(after.estRevenueCents).toBe(5000); // the line total, not the typed figure

    must(await removeOpportunityLine(c, o.id, l.id));
    expect(await est(c, o.id)).toBe(5000); // the last calculated figure stays...
    must(await updateOpportunity(c, o.id, { estRevenueCents: 7000 }));
    expect(await est(c, o.id)).toBe(7000); // ...and is editable by hand again
  });

  it("removing a line renumbers the rest and recalculates", async () => {
    const { admin: c } = await newBusiness();
    const o = await opp(c);
    const lines = [];
    for (const [d, price] of [
      ["A", 100],
      ["B", 200],
      ["C", 400],
    ] as const) {
      lines.push(
        must(
          await addOpportunityLine(c, o.id, { description: d, quantity: 1, unitPriceCents: price }),
        ).line,
      );
    }
    must(await removeOpportunityLine(c, o.id, lines[0]!.id));
    const rest = must(await listOpportunityLines(c, o.id)).lines;
    expect(rest.map((l) => [l.lineNumber, l.description])).toEqual([
      [1, "B"],
      [2, "C"],
    ]);
    expect(await est(c, o.id)).toBe(600);
    expect(await removeOpportunityLine(c, o.id, lines[0]!.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("validates lines", async () => {
    const { admin: c } = await newBusiness();
    const o = await opp(c);
    const bad = (v: Record<string, unknown>) => addOpportunityLine(c, o.id, v);
    expect(await bad({ description: "x", quantity: -1, unitPriceCents: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await bad({ quantity: 1, unitPriceCents: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    }); // write-in needs a description
    expect(await bad({ description: "x", quantity: 1 })).toMatchObject({
      ok: false,
      code: "invalid",
    }); // and a price
    expect(await bad({ description: "x", quantity: 1, unitPriceCents: 1.5 })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await bad({ productId: "7b0a5f5e-9d0b-4a6e-8f5b-3f2f1b9c1d11", quantity: 1 }),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await addOpportunityLine(c, "not-a-uuid", {
        description: "x",
        quantity: 1,
        unitPriceCents: 1,
      }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await listOpportunityLines(c, o.id)).lines).toHaveLength(0);
  });

  it("a closed opportunity's products are read-only until it is reopened", async () => {
    const { admin: c } = await newBusiness();
    const o = await opp(c, { estRevenueCents: 1000, estCloseDate: "2030-01-01" });
    const l = must(
      await addOpportunityLine(c, o.id, { description: "x", quantity: 1, unitPriceCents: 1000 }),
    ).line;
    must(await closeAsWon(c, o.id, { actualRevenueCents: 1000 }));
    expect(
      await addOpportunityLine(c, o.id, { description: "y", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "read_only" });
    expect(await removeOpportunityLine(c, o.id, l.id)).toMatchObject({
      ok: false,
      code: "read_only",
    });
    must(await reopenOpportunity(c, o.id));
    must(await removeOpportunityLine(c, o.id, l.id));
  });

  it("a quote started from the opportunity copies its lines, with each product's tax", async () => {
    const { admin: c } = await newBusiness();
    const tax = must(await createTaxRate(c, { name: "Sales tax", rateBp: 700 })).taxRate;
    const taxed = must(
      await createProduct(c, {
        sku: `T-${rand()}`,
        name: "Taxed",
        listPriceCents: 1000,
        taxRateId: tax.id,
      }),
    ).product;
    const o = await opp(c);
    must(
      await addOpportunityLine(c, o.id, { productId: taxed.id, quantity: 2, discountCents: 100 }),
    );
    must(
      await addOpportunityLine(c, o.id, {
        description: "Labour",
        quantity: 1,
        unitPriceCents: 5000,
      }),
    );

    const q = must(await createQuote(c, { name: "From opp", opportunityId: o.id })).quote;
    const full = must(await getQuote(c, q.id));
    expect(
      full.lines.map((l) => [
        l.lineNumber,
        l.description,
        l.quantityMilli,
        l.unitPriceCents,
        l.discountCents,
        l.taxRateBp,
      ]),
    ).toEqual([
      [1, "Taxed", 2000, 1000, 100, 700],
      [2, "Labour", 1000, 5000, 0, 0],
    ]);
    // 1900 + 5000 = 6900; tax 7% of 1900 = 133
    expect(full.quote).toMatchObject({ subtotalCents: 6900, taxCents: 133, totalCents: 7033 });

    // The quote's lines are its own: changing it doesn't touch the opportunity.
    must(await addLine(c, q.id, { description: "Extra", quantity: 1, unitPriceCents: 100 }));
    expect(must(await listOpportunityLines(c, o.id)).lines).toHaveLength(2);
    expect(await est(c, o.id)).toBe(6900);
  });

  it("a quote from an opportunity with no lines starts empty", async () => {
    const { admin: c } = await newBusiness();
    const o = await opp(c);
    const q = must(await createQuote(c, { name: "Empty", opportunityId: o.id })).quote;
    expect(must(await getQuote(c, q.id)).lines).toHaveLength(0);
  });

  it("permissions: others' opportunities are hidden, read-only users can look but not change, other businesses see nothing", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const o = await opp(a.admin);
    const l = must(
      await addOpportunityLine(a.admin, o.id, {
        description: "x",
        quantity: 1,
        unitPriceCents: 100,
      }),
    ).line;

    const rep = await addUser(a, "Salesperson"); // user-level: not the owner
    expect(await listOpportunityLines(rep, o.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await addOpportunityLine(rep, o.id, { description: "y", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await removeOpportunityLine(rep, o.id, l.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });

    const viewer = await addUser(a, "Read-only"); // organization-level read, no write
    expect(must(await listOpportunityLines(viewer, o.id)).lines).toHaveLength(1);
    expect(
      await addOpportunityLine(viewer, o.id, { description: "y", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(await removeOpportunityLine(viewer, o.id, l.id)).toMatchObject({
      ok: false,
      code: "forbidden",
    });

    expect(await listOpportunityLines(b.admin, o.id)).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(
      await addOpportunityLine(b.admin, o.id, { description: "y", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await est(a.admin, o.id)).toBe(100);
  });
});
