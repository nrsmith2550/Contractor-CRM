import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withPlatform, withTenant } from "@/db/client";
import { auditLog, securityRole, tenant } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount } from "@/server/domain/accounts";
import { setLogo } from "@/server/domain/branding";
import { createProduct } from "@/server/domain/catalog";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { activateQuote, addLine, createQuote } from "@/server/domain/quotes";
import type { Email } from "@/server/email/mailer";
import { mintLicense } from "@/server/licensing/mint";
import { buildQuotePdf } from "@/server/pdf/build";
import { PNG_1PX } from "../support/images";

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

async function activeQuote(c: Ctx, activate = true) {
  const widget = must(
    await createProduct(c, { sku: `W-${rand()}`, name: "Widget", listPriceCents: 1999 }),
  ).product;
  const acct = must(
    await createAccount(c, {
      name: "Buyer Inc",
      addressStreet: "1 Main St",
      addressCity: "Pittsburgh",
    }),
  ).account;
  const q = must(
    await createQuote(c, {
      name: "Fence job",
      customerAccountId: acct.id,
      termsText: "Net 30. Prices valid 30 days.",
    }),
  ).quote;
  must(await addLine(c, q.id, { productId: widget.id, quantity: 3 }));
  if (activate) must(await activateQuote(c, q.id));
  return q;
}

const isPdf = (b: Buffer) =>
  b.subarray(0, 5).toString("latin1") === "%PDF-" &&
  b.subarray(-6).toString("latin1").includes("%%EOF");

describe.skipIf(!enabled)("Quote PDF and branding", () => {
  it("renders a PDF for an active quote, and refuses a draft", async () => {
    const { admin: c } = await newBusiness();
    const draft = await activeQuote(c, false);
    expect(await buildQuotePdf(c, draft.id)).toMatchObject({ ok: false, code: "read_only" });
    must(await activateQuote(c, draft.id));
    const r = must(await buildQuotePdf(c, draft.id));
    expect(isPdf(r.pdf)).toBe(true);
    expect(r.pdf.length).toBeGreaterThan(1000);
    expect(r.filename).toBe(`${draft.quoteNumber}.pdf`);
  });

  it("PDF renders with the tenant logo: the file changes and stays valid", async () => {
    const { admin: c, tenantId } = await newBusiness();
    const q = await activeQuote(c);
    const before = must(await buildQuotePdf(c, q.id)).pdf;
    must(await setLogo(c, PNG_1PX));
    const stored = await withPlatform((tx) =>
      tx.select({ l: tenant.logoUrl }).from(tenant).where(eq(tenant.id, tenantId)),
    );
    expect(stored[0]!.l).toBe(PNG_1PX);
    const after = must(await buildQuotePdf(c, q.id)).pdf;
    expect(isPdf(after)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length); // the embedded image adds bytes
    expect(
      (
        await withTenant(tenantId, (tx) =>
          tx.select().from(auditLog).where(eq(auditLog.recordId, tenantId)),
        )
      ).map((a) => a.action),
    ).toContain("set_logo");
    must(await setLogo(c, null));
    expect(isPdf(must(await buildQuotePdf(c, q.id)).pdf)).toBe(true);
  });

  it("rejects bad logos and only administrators may set one", async () => {
    const biz = await newBusiness();
    expect(
      await setLogo(biz.admin, "data:image/png;base64," + Buffer.from("nope").toString("base64")),
    ).toMatchObject({ ok: false, code: "invalid" });
    const rep = await addUser(biz, "Salesperson");
    expect(await setLogo(rep, PNG_1PX)).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("only people who can read the quote can get its PDF", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const q = await activeQuote(a.admin);
    expect(await buildQuotePdf(b.admin, q.id)).toMatchObject({ ok: false, code: "not_found" });
    const rep = await addUser(a, "Salesperson"); // user-level read: not the owner of this quote
    expect(await buildQuotePdf(rep, q.id)).toMatchObject({ ok: false, code: "not_found" });
  });
});
