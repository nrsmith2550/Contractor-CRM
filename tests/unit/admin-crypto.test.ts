import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "@/server/admin/crypto";
import {
  base32Decode,
  base32Encode,
  currentStep,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from "@/server/admin/totp";

const KEY = randomBytes(32).toString("base64");
beforeEach(() => vi.stubEnv("ADMIN_TOTP_KEY", KEY));
afterEach(() => vi.unstubAllEnvs());

describe("TOTP (RFC 6238)", () => {
  // Appendix B of RFC 6238, HMAC-SHA1 with the ASCII secret "12345678901234567890", 8 digits.
  const rfcSecret = Buffer.from("12345678901234567890");
  const vectors: [seconds: number, code: string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(vectors)("matches the RFC test vector at T=%i", (seconds, expected) => {
    expect(totpCode(rfcSecret, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it("produces 6-digit codes by default, zero-padded", () => {
    for (let step = 0; step < 50; step++) expect(totpCode(rfcSecret, step)).toMatch(/^\d{6}$/);
  });

  it("round-trips base32 (RFC 4648 vectors and random secrets)", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("MZXW6YTBOI").toString()).toBe("foobar");
    expect(base32Decode("mzxw 6ytb oi======").toString()).toBe("foobar");
    for (let i = 0; i < 50; i++) {
      const s = randomBytes(20);
      expect(base32Decode(base32Encode(s)).equals(s)).toBe(true);
    }
    expect(() => base32Decode("not base32!")).toThrow();
  });

  it("accepts the current step and one step of drift either side, but no more", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    for (const d of [-1, 0, 1]) {
      expect(verifyTotp({ secret, code: totpCode(secret, step + d), nowMs: now })).toEqual({
        ok: true,
        step: step + d,
      });
    }
    for (const d of [-2, 2, 10]) {
      expect(verifyTotp({ secret, code: totpCode(secret, step + d), nowMs: now }).ok).toBe(false);
    }
  });

  it("burns an accepted code: it can't be replayed, and neither can any older step", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    const at = (s: number, lastStep?: number) =>
      verifyTotp({ secret, code: totpCode(secret, s), lastStep, nowMs: now }).ok;
    expect(verifyTotp({ secret, code: totpCode(secret, step), nowMs: now })).toEqual({
      ok: true,
      step,
    });
    expect(at(step, step)).toBe(false);
    expect(at(step - 1, step)).toBe(false);
    expect(at(step + 1, step)).toBe(true); // a later step still works
  });

  it("rejects malformed codes and tolerates spaces", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    const good = totpCode(secret, currentStep(now));
    for (const bad of ["", "12345", "1234567", "abcdef", " ", "12 34 5"]) {
      expect(verifyTotp({ secret, code: bad, nowMs: now }).ok).toBe(false);
    }
    const spaced = `${good.slice(0, 3)} ${good.slice(3)}`;
    expect(verifyTotp({ secret, code: spaced, nowMs: now }).ok).toBe(true);
  });

  it("builds an otpauth URI an authenticator can import", () => {
    const secret = Buffer.from("12345678901234567890");
    const uri = otpauthUri({ email: "ada@example.test", secret, issuer: "CRM Admin" });
    expect(uri.startsWith("otpauth://totp/CRM%20Admin:ada%40example.test?")).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get("secret")).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(params.get("digits")).toBe("6");
    expect(params.get("period")).toBe("30");
  });
});

describe("secret encryption at rest", () => {
  it("round-trips and never stores the secret in the clear", () => {
    const secret = generateTotpSecret();
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(base32Encode(secret));
    expect(Buffer.from(enc, "base64").includes(secret)).toBe(false);
    expect(decryptSecret(enc).equals(secret)).toBe(true);
  });

  it("uses a fresh IV each time", () => {
    const secret = generateTotpSecret();
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("detects tampering and a wrong key", () => {
    const enc = encryptSecret(generateTotpSecret());
    const bytes = Buffer.from(enc, "base64");
    bytes[bytes.length - 1]! ^= 1;
    expect(() => decryptSecret(bytes.toString("base64"))).toThrow();
    expect(() => decryptSecret("AAAA")).toThrow();

    vi.stubEnv("ADMIN_TOTP_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("requires a 32-byte key", () => {
    vi.stubEnv("ADMIN_TOTP_KEY", "");
    expect(() => encryptSecret(generateTotpSecret())).toThrow(/not set/);
    vi.stubEnv("ADMIN_TOTP_KEY", Buffer.from("too short").toString("base64"));
    expect(() => encryptSecret(generateTotpSecret())).toThrow(/32/);
  });
});
