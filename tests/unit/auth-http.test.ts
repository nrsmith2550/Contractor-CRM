import { describe, expect, it } from "vitest";
import { activateFormSchema, changePasswordSchema, loginSchema } from "@/lib/validation/auth";
import { clientIpFrom, safeNextPath } from "@/server/auth/http";

const headers = (init: Record<string, string>) => new Headers(init);

describe("clientIpFrom", () => {
  it("prefers the edge-set CF-Connecting-IP", () => {
    expect(
      clientIpFrom(headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("203.0.113.9");
  });

  it("uses X-Real-IP next", () => {
    expect(
      clientIpFrom(headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("198.51.100.4");
  });

  it("uses the RIGHTMOST X-Forwarded-For entry: the leftmost is client-controlled", () => {
    // A caller can send "X-Forwarded-For: 9.9.9.9" to dodge limits; our proxy appends the real IP.
    expect(clientIpFrom(headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.50" }))).toBe(
      "203.0.113.50",
    );
  });

  it("falls back to 'unknown' and bounds the length", () => {
    expect(clientIpFrom(headers({}))).toBe("unknown");
    expect(clientIpFrom(headers({ "cf-connecting-ip": "x".repeat(500) }))).toHaveLength(64);
  });
});

describe("safeNextPath (open-redirect guard)", () => {
  it("allows paths inside the app", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/leads/123?tab=2")).toBe("/app/leads/123?tab=2");
  });

  it("rejects everything else", () => {
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "/login",
      "app",
      "",
      undefined,
      null,
      42,
      "/app\\..\\evil",
    ]) {
      expect(safeNextPath(bad)).toBe("/app");
    }
  });
});

describe("form schemas (shared by the browser and the server)", () => {
  const good = {
    licenseKey: "CRM-AAAAA-BBBBB-CCCCC-DDDDDD",
    companyName: " Acme Plumbing ",
    ownerName: "Jo Rivers",
    ownerEmail: " Jo@Acme.TEST ",
    password: "violet-lantern-orbit-42",
    confirmPassword: "violet-lantern-orbit-42",
    timeZone: "America/New_York",
    currency: "USD",
  };

  it("normalizes input (trim, lowercase email)", () => {
    const r = activateFormSchema.safeParse(good);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ownerEmail).toBe("jo@acme.test");
      expect(r.data.companyName).toBe("Acme Plumbing");
    }
  });

  it("flags the confirm field when passwords differ, and bad zone/currency/email", () => {
    const r = activateFormSchema.safeParse({ ...good, confirmPassword: "different" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.path).toEqual(["confirmPassword"]);

    expect(activateFormSchema.safeParse({ ...good, timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(activateFormSchema.safeParse({ ...good, currency: "usd" }).success).toBe(false);
    expect(activateFormSchema.safeParse({ ...good, ownerEmail: "nope" }).success).toBe(false);
  });

  it("login and change-password schemas", () => {
    expect(loginSchema.safeParse({ email: "A@B.TEST", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.test", password: "" }).success).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: "a", password: "b", confirmPassword: "c" })
        .success,
    ).toBe(false);
  });
});
