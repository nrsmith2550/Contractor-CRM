import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, quote as quoteTable, securityRole } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount } from "@/server/domain/accounts";
import {
  createPriceList,
  createProduct,
  createTaxRate,
  listProducts,
  setPriceListItem,
} from "@/server/domain/catalog";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { createOpportunity, getOpportunity } from "@/server/domain/opportunities";
import {
  activateQuote,
  addLine,
  createQuote,
  getOrder,
  getQuote,
  listQuotes,
  loseQuote,
  removeLine,
  reviseQuote,
  updateQuote,
  winQuote,
} from "@/server/domain/quotes";
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

const auditOf = (tenantId: string, recordId: string) =>
  withTenant(tenantId, (tx) => tx.select().from(auditLog).where(eq(auditLog.recordId, recordId)));

async function setup() {
  const biz = await newBusiness();
  const c = biz.admin;
  const tax = must(await createTaxRate(c, { name: "Sales tax", rateBp: 700 })).taxRate;
  const widget = must(
    await createProduct(c, {
      sku: `W-${rand()}`,
      name: "Widget",
      listPriceCents: 1999,
      taxRateId: tax.id,
    }),
  ).product;
  const labour = must(
    await createProduct(c, {
      sku: `L-${rand()}`,
      name: "Labour hour",
      productType: "service",
      listPriceCents: 9500,
    }),
  ).product;
  return { biz, c, tax, widget, labour };
}

describe.skipIf(!enabled)("Phase 3 acceptance criteria", () => {
  it("Totals are correct to the cent across discount, freight and tax", async () => {
    const { c, widget } = await setup();
    const q = must(
      await createQuote(c, { name: "Fence", freightCents: 1250, discountPercentBp: 1000 }),
    ).quote;
    expect(q.quoteNumber).toBe("QUO-01001");
    const r = must(await addLine(c, q.id, { productId: widget.id, quantity: 3 }));
    // 3 x $19.99 = 5997; 10% off = 600; taxable 5397 x 7% = 378 (377.79); total 5997 - 600 + 1250 + 378
    expect(r.line).toMatchObject({
      unitPriceCents: 1999,
      taxRateBp: 700,
      extendedCents: 5997,
      description: "Widget",
    });
    expect(r.quote).toMatchObject({
      subtotalCents: 5997,
      discountCents: 600,
      taxCents: 378,
      totalCents: 7025,
    });
    must(
      await addLine(c, q.id, { description: "Disposal fee", quantity: 1, unitPriceCents: 4000 }),
    );
    const full = must(await getQuote(c, q.id));
    expect(full.lines.map((l) => l.lineNumber)).toEqual([1, 2]);
    expect(full.quote.subtotalCents).toBe(9997);
    expect(full.quote.totalCents).toBe(
      full.quote.subtotalCents - full.quote.discountCents + 1250 + full.quote.taxCents,
    );
  });

  it("Revise produces -R1 as Draft and the original becomes Closed-Revised", async () => {
    const { c, widget } = await setup();
    const q = must(await createQuote(c, { name: "Deck" })).quote;
    must(await addLine(c, q.id, { productId: widget.id, quantity: 2 }));
    expect(await reviseQuote(c, q.id)).toMatchObject({ ok: false, code: "read_only" }); // still a draft
    must(await activateQuote(c, q.id));
    const r = must(await reviseQuote(c, q.id));
    expect(r.revised.status).toBe("revised");
    expect(r.quote).toMatchObject({
      quoteNumber: "QUO-01001-R1",
      status: "draft",
      revisionNumber: 1,
      totalCents: q.totalCents + 3998 + 280,
    });
    expect(must(await getQuote(c, r.quote.id)).lines).toHaveLength(1);
    must(await activateQuote(c, r.quote.id));
    expect(must(await reviseQuote(c, r.quote.id)).quote.quoteNumber).toBe("QUO-01001-R2");
  });

  it("Active quotes are read-only", async () => {
    const { c, widget } = await setup();
    const q = must(await createQuote(c, { name: "Patio" })).quote;
    expect(await activateQuote(c, q.id)).toMatchObject({ ok: false, code: "missing_fields" });
    const { line } = must(await addLine(c, q.id, { productId: widget.id, quantity: 1 }));
    must(await activateQuote(c, q.id));
    const ro = { ok: false, code: "read_only" };
    expect(await updateQuote(c, q.id, { name: "Changed" })).toMatchObject(ro);
    expect(
      await addLine(c, q.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject(ro);
    expect(await removeLine(c, q.id, line.id)).toMatchObject(ro);
    expect(await activateQuote(c, q.id)).toMatchObject(ro);
  });

  it("A won quote creates an order and can close the opportunity as Won", async () => {
    const { c, widget } = await setup();
    const acct = must(
      await createAccount(c, { name: "Buyer Inc", relationshipType: "prospect" }),
    ).account;
    const opp = must(
      await createOpportunity(c, { name: "Big job", customerAccountId: acct.id }),
    ).opportunity;
    const q = must(
      await createQuote(c, { name: "Big quote", opportunityId: opp.id, freightCents: 500 }),
    ).quote;
    expect(q.customerAccountId).toBe(acct.id); // copied from the opportunity
    must(await addLine(c, q.id, { productId: widget.id, quantity: 4 }));
    must(await activateQuote(c, q.id));
    const won = must(await winQuote(c, q.id, { closeOpportunity: true }));
    expect(won.quote.status).toBe("won");
    expect(won.opportunityClosed).toBe(true);
    expect(won.order).toMatchObject({
      orderNumber: "ORD-01001",
      totalCents: won.quote.totalCents,
      quoteId: q.id,
    });
    const order = must(await getOrder(c, won.order.id));
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ description: "Widget", extendedCents: 7996 });
    expect(must(await getOpportunity(c, opp.id)).opportunity).toMatchObject({
      status: "won",
      actualRevenueCents: won.quote.totalCents,
    });
    expect(await winQuote(c, q.id)).toMatchObject({ ok: false, code: "read_only" }); // can't win twice
    const audit = await auditOf(c.tenantId, q.id);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["create", "activate", "win"]),
    );
  });
});

describe.skipIf(!enabled)("Catalog and quote rules", () => {
  it("prices come from the price list, falling back to the product's list price", async () => {
    const { c, widget, labour } = await setup();
    const pl = must(await createPriceList(c, { name: "Contractors" })).priceList;
    must(await setPriceListItem(c, pl.id, widget.id, 1500));
    const q = must(await createQuote(c, { name: "PL quote", priceListId: pl.id })).quote;
    expect(
      must(await addLine(c, q.id, { productId: widget.id, quantity: 1 })).line.unitPriceCents,
    ).toBe(1500);
    expect(
      must(await addLine(c, q.id, { productId: labour.id, quantity: 1 })).line.unitPriceCents,
    ).toBe(9500);
    must(await setPriceListItem(c, pl.id, widget.id, 1400)); // replaces
    expect(
      must(await addLine(c, q.id, { productId: widget.id, quantity: 1 })).line.unitPriceCents,
    ).toBe(1400);
  });

  it("validates input and keeps line numbers contiguous", async () => {
    const { c, widget } = await setup();
    expect(await createQuote(c, { name: "  " })).toMatchObject({ ok: false, code: "invalid" });
    expect(
      await createQuote(c, { name: "x", discountPercentBp: 100, discountAmountCents: 100 }),
    ).toMatchObject({ ok: false, code: "invalid" });
    const q = must(await createQuote(c, { name: "Lines" })).quote;
    expect(await addLine(c, q.id, { quantity: 1, unitPriceCents: 5 })).toMatchObject({
      ok: false,
      code: "invalid",
    }); // no description
    expect(
      await addLine(c, q.id, { description: "x", quantity: -1, unitPriceCents: 5 }),
    ).toMatchObject({ ok: false, code: "invalid" });
    const a = must(await addLine(c, q.id, { productId: widget.id, quantity: 1 })).line;
    must(await addLine(c, q.id, { description: "B", quantity: 1, unitPriceCents: 100 }));
    must(await addLine(c, q.id, { description: "C", quantity: 1, unitPriceCents: 200 }));
    must(await removeLine(c, q.id, a.id));
    const lines = must(await getQuote(c, q.id)).lines;
    expect(lines.map((l) => [l.lineNumber, l.description])).toEqual([
      [1, "B"],
      [2, "C"],
    ]);
    expect(await removeLine(c, q.id, a.id)).toMatchObject({ ok: false, code: "not_found" });
    // switching discount kind clears the other
    must(await updateQuote(c, q.id, { discountPercentBp: 500 }));
    const u = must(await updateQuote(c, q.id, { discountAmountCents: 100 })).quote;
    expect(u).toMatchObject({
      discountPercentBp: null,
      discountAmountCents: 100,
      discountCents: 100,
      totalCents: 200,
    });
  });

  it("duplicate SKUs are rejected and lost quotes are closed", async () => {
    const { c, widget } = await setup();
    expect(await createProduct(c, { sku: widget.sku, name: "Other" })).toMatchObject({
      ok: false,
      code: "conflict",
    });
    const q = must(await createQuote(c, { name: "Lost one" })).quote;
    must(await addLine(c, q.id, { productId: widget.id, quantity: 1 }));
    expect(await loseQuote(c, q.id)).toMatchObject({ ok: false, code: "read_only" });
    must(await activateQuote(c, q.id));
    expect(must(await loseQuote(c, q.id)).quote.status).toBe("lost");
  });

  it("permissions: reps read the catalog but can't change it, and only see their own quotes", async () => {
    const { biz, c, widget } = await setup();
    const rep = await addUser(biz, "Salesperson");
    expect(must(await listProducts(rep)).rows.length).toBeGreaterThan(0);
    expect(await createProduct(rep, { sku: "NOPE", name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(await createPriceList(rep, { name: "Nope" })).toMatchObject({
      ok: false,
      code: "forbidden",
    });
    const mine = must(await createQuote(rep, { name: "Rep quote" })).quote;
    const adminsQuote = must(await createQuote(c, { name: "Admin quote" })).quote;
    must(await addLine(rep, mine.id, { productId: widget.id, quantity: 1 }));
    expect(await getQuote(rep, adminsQuote.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(
      await addLine(rep, adminsQuote.id, { description: "x", quantity: 1, unitPriceCents: 1 }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(must(await listQuotes(rep)).rows.map((q) => q.id)).toEqual([mine.id]);
    expect(must(await listQuotes(c)).total).toBe(2);
  });

  it("another business can't see or touch this business's quotes", async () => {
    const a = await setup();
    const b = await setup();
    const q = must(await createQuote(a.c, { name: "Private" })).quote;
    expect(await getQuote(b.c, q.id)).toMatchObject({ ok: false, code: "not_found" });
    expect(await updateQuote(b.c, q.id, { name: "Hacked" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(must(await listQuotes(b.c)).total).toBe(0);
    const rows = await withTenant(b.c.tenantId, (tx) => tx.select().from(quoteTable));
    expect(rows).toHaveLength(0);
  });
});
