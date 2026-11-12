import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db/client";
import { auditLog, securityRole, systemUser } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createAccount } from "@/server/domain/accounts";
import { timeline } from "@/server/domain/activities";
import { createProduct } from "@/server/domain/catalog";
import { buildCtx, type Ctx } from "@/server/domain/context";
import { QUOTE_EMAIL_LIMIT, emailQuote } from "@/server/domain/quote-email";
import { activateQuote, addLine, createQuote, reviseQuote } from "@/server/domain/quotes";
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

async function quoteFor(c: Ctx, activate = true) {
  const widget = must(
    await createProduct(c, { sku: `W-${rand()}`, name: "Widget", listPriceCents: 1999 }),
  ).product;
  const acct = must(await createAccount(c, { name: "Buyer Inc" })).account;
  const q = must(await createQuote(c, { name: "Fence job", customerAccountId: acct.id })).quote;
  must(await addLine(c, q.id, { productId: widget.id, quantity: 3 }));
  if (activate) must(await activateQuote(c, q.id));
  return q;
}

const capture = () => {
  const sent: Email[] = [];
  return { sent, send: async (e: Email) => void sent.push(e) };
};

describe.skipIf(!enabled)("Emailing a quote", () => {
  it("sends the PDF, replies go to the sender, and an outgoing email activity is logged on the quote", async () => {
    const biz = await newBusiness();
    const c = biz.admin;
    const q = await quoteFor(c);
    const { sent, send } = capture();
    const r = must(
      await emailQuote(
        c,
        q.id,
        { to: " Buyer@Example.TEST ", message: "Thanks for calling" },
        { send },
      ),
    );
    expect(r.to).toBe("buyer@example.test");

    expect(sent).toHaveLength(1);
    const mail = sent[0]!;
    expect(mail).toMatchObject({
      to: "buyer@example.test",
      subject: `Quote ${q.quoteNumber} from ${mail.subject.split(" from ")[1]}`,
    });
    expect(mail.text).toContain("Thanks for calling");
    expect(mail.text).toContain("$59.97"); // 3 x 19.99; this product has no tax rate
    const [me] = await withTenant(c.tenantId, (tx) =>
      tx.select({ email: systemUser.email }).from(systemUser).where(eq(systemUser.id, c.userId)),
    );
    expect(mail.replyTo).toBe(me!.email);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0]).toMatchObject({
      filename: `${q.quoteNumber}.pdf`,
      contentType: "application/pdf",
    });
    expect(mail.attachments![0]!.content.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const tl = must(await timeline(c, "quote", q.id));
    const act = tl.items.find((i) => i.kind === "activity")!;
    expect(act).toMatchObject({ kind: "activity" });
    if (act.kind === "activity") {
      expect(act.activity).toMatchObject({
        activityType: "email",
        direction: "outgoing",
        status: "completed",
        regardingType: "quote",
        regardingId: q.id,
        subject: mail.subject,
      });
      expect(act.activity.description).toContain("To: buyer@example.test");
    }
    const audit = await withTenant(c.tenantId, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.recordId, q.id)),
    );
    expect(audit.map((a) => a.action)).toContain("email");
  });

  it("refuses a draft, a revised quote and a bad address, and sends nothing", async () => {
    const { admin: c } = await newBusiness();
    const { sent, send } = capture();
    const draft = await quoteFor(c, false);
    expect(await emailQuote(c, draft.id, { to: "buyer@example.test" }, { send })).toMatchObject({
      ok: false,
      code: "read_only",
    });

    const active = await quoteFor(c);
    expect(await emailQuote(c, active.id, { to: "not-an-email" }, { send })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(await emailQuote(c, active.id, { to: "" }, { send })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(
      await emailQuote(c, active.id, { to: "a@example.test", message: "x".repeat(2001) }, { send }),
    ).toMatchObject({ ok: false, code: "invalid" });

    must(await reviseQuote(c, active.id));
    expect(await emailQuote(c, active.id, { to: "buyer@example.test" }, { send })).toMatchObject({
      ok: false,
      code: "read_only",
    });

    expect(sent).toHaveLength(0);
    for (const id of [draft.id, active.id]) {
      expect(must(await timeline(c, "quote", id)).items).toHaveLength(0);
    }
  });

  it("logs nothing when the provider fails, and doesn't leak its message", async () => {
    const { admin: c } = await newBusiness();
    const q = await quoteFor(c);
    const r = await emailQuote(
      c,
      q.id,
      { to: "buyer@example.test" },
      {
        send: async () => {
          throw new Error("Email provider rejected the message (403) key=re_SECRET");
        },
      },
    );
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    expect(JSON.stringify(r)).not.toContain("re_SECRET");
    expect(must(await timeline(c, "quote", q.id)).items).toHaveLength(0);
  });

  it("limits how many quotes one user can send per hour", async () => {
    const { admin: c } = await newBusiness();
    const q = await quoteFor(c);
    const { sent, send } = capture();
    for (let i = 0; i < QUOTE_EMAIL_LIMIT.max; i++)
      must(await emailQuote(c, q.id, { to: `b${i}@example.test` }, { send }));
    expect(await emailQuote(c, q.id, { to: "one-more@example.test" }, { send })).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
    expect(sent).toHaveLength(QUOTE_EMAIL_LIMIT.max);
  });

  it("only someone who can read the quote can send it", async () => {
    const a = await newBusiness();
    const b = await newBusiness();
    const q = await quoteFor(a.admin);
    const { sent, send } = capture();
    expect(await emailQuote(b.admin, q.id, { to: "x@example.test" }, { send })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    const rep = await addUser(a, "Salesperson"); // can't read another user's quote
    expect(await emailQuote(rep, q.id, { to: "x@example.test" }, { send })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(sent).toHaveLength(0);
  });
});
