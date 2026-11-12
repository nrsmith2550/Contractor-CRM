import { describe, expect, it } from "vitest";
import { hashPassword, validatePassword, verifyPassword } from "@/server/auth/password";
import { hashToken, newToken, safeEqualHex } from "@/server/auth/tokens";
import { isAllowed } from "@/server/auth/rate-limit";

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("correct horse");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "wrong horse battery staple")).toBe(false);
  });

  it("salts: the same password hashes differently each time", async () => {
    expect(await hashPassword("same password here")).not.toBe(
      await hashPassword("same password here"),
    );
  });

  it("returns false (not an exception) for a garbage hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever password")).toBe(false);
  });

  it("enforces the policy", () => {
    expect(validatePassword("short")).toMatchObject({ ok: false });
    expect(validatePassword("password1234")).toMatchObject({ ok: false });
    expect(validatePassword("aaaaaaaaaaaaaa")).toMatchObject({ ok: false });
    expect(validatePassword("My-Password-Is-Long!")).toMatchObject({ ok: false }); // contains "password"
    expect(validatePassword("jonathan-smith-2026", ["Jonathan Smith"])).toMatchObject({ ok: true });
    expect(validatePassword("acmeplumbing-2026!", ["acmeplumbing"])).toMatchObject({ ok: false });
    expect(validatePassword("violet-lantern-orbit-42")).toEqual({ ok: true });
  });
});

describe("tokens", () => {
  it("are 256-bit URL-safe and stored only as sha256 hashes", () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });

  it("compares digests in constant time and rejects mismatches", () => {
    const h = hashToken("abc");
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken("abd"))).toBe(false);
    expect(safeEqualHex(h, "")).toBe(false);
  });
});

describe("rate limit decision", () => {
  it("allows up to max attempts and blocks the next", () => {
    expect(isAllowed(5, 5)).toBe(true);
    expect(isAllowed(6, 5)).toBe(false);
  });
});
