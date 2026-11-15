import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withPlatform } from "@/db/client";
import { adminAuditLog, consultationRequest } from "@/db/schema";
import {
  listConsultationRequests,
  submitConsultationRequest,
  updateConsultationRequest,
} from "@/server/domain/consultations";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const form = (over: Record<string, unknown> = {}) => ({
  name: "Pat Jones",
  email: `pat-${rand()}@example.test`,
  phone: "412-555-0100",
  business: "Jones Heating",
  trade: "hvac",
  teamSize: "2-5",
  bestTime: "saturdays",
  timeZone: "America/New_York",
  ...over,
});

describe.skipIf(!enabled)("Consultation requests", () => {
  it("stores a valid request as new", async () => {
    const res = await submitConsultationRequest(form(), { ip: `ip-${rand()}` });
    expect(res.ok).toBe(true);
    if (!res.ok || !res.request) throw new Error("expected a stored request");
    expect(res.request.status).toBe("new");
    expect(res.request.bestTime).toBe("saturdays");
  });

  it("reports which fields are wrong and stores nothing", async () => {
    const res = await submitConsultationRequest(form({ phone: "12", trade: "x" }), {
      ip: `ip-${rand()}`,
    });
    expect(res.ok).toBe(false);
    if (res.ok || res.code !== "invalid") throw new Error("expected invalid");
    expect(Object.keys(res.errors)).toEqual(expect.arrayContaining(["phone", "trade"]));
  });

  it("quietly ignores a request that fills in the hidden trap field", async () => {
    const email = `bot-${rand()}@example.test`;
    const res = await submitConsultationRequest(form({ email, website: "http://spam.test" }), {
      ip: `ip-${rand()}`,
    });
    expect(res).toEqual({ ok: true, request: null });
    const rows = await listConsultationRequests();
    expect(rows.some((r) => r.email === email)).toBe(false);
  });

  it("limits one connection to five requests an hour", async () => {
    const ip = `ip-${rand()}`;
    for (let i = 0; i < 5; i++) {
      expect((await submitConsultationRequest(form(), { ip })).ok).toBe(true);
    }
    const sixth = await submitConsultationRequest(form(), { ip });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.code).toBe("rate_limited");
  });

  it("limits one email address to three requests a day", async () => {
    const email = `same-${rand()}@example.test`;
    for (let i = 0; i < 3; i++) {
      expect((await submitConsultationRequest(form({ email }), { ip: `ip-${rand()}` })).ok).toBe(
        true,
      );
    }
    const fourth = await submitConsultationRequest(form({ email }), { ip: `ip-${rand()}` });
    expect(fourth.ok).toBe(false);
  });

  it("lets the owner track a request, and audits each change", async () => {
    const res = await submitConsultationRequest(form(), { ip: `ip-${rand()}` });
    if (!res.ok || !res.request) throw new Error("expected a stored request");
    const id = res.request.id;
    const admin = { adminId: null as unknown as string, ip: "203.0.113.9" };

    const bad = await updateConsultationRequest(admin, { id, status: "bogus" });
    expect(bad.ok).toBe(false);
    const missing = await updateConsultationRequest(admin, {
      id: "00000000-0000-0000-0000-000000000000",
      status: "done",
    });
    expect(missing.ok).toBe(false);

    const ok = await updateConsultationRequest(admin, {
      id,
      status: "scheduled",
      notes: "  Call Tuesday 7pm  ",
    });
    expect(ok).toEqual({ ok: true, status: "scheduled" });

    const [row] = await withPlatform((tx) =>
      tx.select().from(consultationRequest).where(eq(consultationRequest.id, id)),
    );
    expect(row?.status).toBe("scheduled");
    expect(row?.notes).toBe("Call Tuesday 7pm");
    expect(row?.handledAt).toBeInstanceOf(Date);

    const audit = await withPlatform((tx) =>
      tx.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, id)),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.action).toBe("consultation.update");
    expect(audit[0]?.reason).toBe("new -> scheduled");

    // Putting it back to "new" clears the handled time.
    await updateConsultationRequest(admin, { id, status: "new", notes: "" });
    const [again] = await withPlatform((tx) =>
      tx.select().from(consultationRequest).where(eq(consultationRequest.id, id)),
    );
    expect(again?.handledAt).toBeNull();
    expect(again?.notes).toBeNull();
  });

  it("filters the list by status", async () => {
    const res = await submitConsultationRequest(form(), { ip: `ip-${rand()}` });
    if (!res.ok || !res.request) throw new Error("expected a stored request");
    const admin = { adminId: null as unknown as string, ip: "203.0.113.9" };
    await updateConsultationRequest(admin, { id: res.request.id, status: "spam" });
    const spam = await listConsultationRequests({ status: "spam" });
    expect(spam.every((r) => r.status === "spam")).toBe(true);
    expect(spam.some((r) => r.id === res.request!.id)).toBe(true);
  });
});
