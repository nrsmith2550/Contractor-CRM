import { describe, expect, it } from "vitest";
import {
  KEY_ALPHABET,
  canonicalLicenseKey,
  generateLicenseKey,
  hashLicenseKey,
  isValidLicenseKey,
  licenseKeyLast5,
  normalizeLicenseKey,
} from "@/server/auth/license-key";

describe("license keys", () => {
  it("generates the CRM-XXXXX-XXXXX-XXXXX-XXXXXC format using the Crockford alphabet", () => {
    const key = generateLicenseKey();
    expect(key).toMatch(
      /^CRM-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{6}$/,
    );
    expect(isValidLicenseKey(key)).toBe(true);
    // No look-alike characters in the alphabet.
    expect(KEY_ALPHABET).not.toMatch(/[ILOU]/);
  });

  it("carries 100 bits of randomness: 1000 keys are all distinct", () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateLicenseKey()));
    expect(keys.size).toBe(1000);
  });

  it("is deterministic for injected randomness", () => {
    const zeros = () => new Uint8Array(20);
    expect(generateLicenseKey(zeros)).toBe(generateLicenseKey(zeros));
  });

  it("normalizes case, separators, the CRM prefix and look-alike characters", () => {
    const key = generateLicenseKey();
    const n = normalizeLicenseKey(key)!;
    expect(n).toHaveLength(21);
    expect(normalizeLicenseKey(key.toLowerCase())).toBe(n);
    expect(normalizeLicenseKey(key.replace(/-/g, " "))).toBe(n);
    expect(normalizeLicenseKey(n)).toBe(n); // no prefix, no dashes
    expect(canonicalLicenseKey(n)).toBe(key);
    // O -> 0, I and L -> 1
    expect(normalizeLicenseKey("CRM-OOOOO-IIIII-LLLLL-000000")).toBe(
      "0".repeat(5) + "1".repeat(10) + "0".repeat(6),
    );
  });

  it("does not mistake a body that starts with C, R, M for the CRM prefix", () => {
    // Index of C, R, M in the alphabet; force the first three body characters to be "CRM".
    const idx = (c: string) => KEY_ALPHABET.indexOf(c);
    const bytes = new Uint8Array(20);
    bytes.set([idx("C"), idx("R"), idx("M")]);
    const key = generateLicenseKey(() => bytes);
    expect(key.startsWith("CRM-CRM")).toBe(true);
    const n = normalizeLicenseKey(key)!;
    expect(n.startsWith("CRM")).toBe(true);
    expect(n).toHaveLength(21);
    expect(isValidLicenseKey(key)).toBe(true);
    expect(isValidLicenseKey(n)).toBe(true); // typed without prefix or dashes
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "CRM", "CRM-AAAAA", "x".repeat(40), "CRM-UUUUU-UUUUU-UUUUU-UUUUUU"]) {
      expect(isValidLicenseKey(bad)).toBe(false);
    }
  });

  it("catches every single-character typo via the checksum", () => {
    const n = normalizeLicenseKey(generateLicenseKey())!;
    for (let i = 0; i < n.length; i++) {
      for (const ch of KEY_ALPHABET) {
        if (ch === n[i]) continue;
        const typo = n.slice(0, i) + ch + n.slice(i + 1);
        expect(isValidLicenseKey(typo)).toBe(false);
      }
    }
  });

  it("hashes the canonical key (sha256 hex) and exposes the last 5 characters", () => {
    const key = generateLicenseKey();
    const n = normalizeLicenseKey(key)!;
    expect(hashLicenseKey(n)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLicenseKey(normalizeLicenseKey(key.toLowerCase())!)).toBe(hashLicenseKey(n));
    expect(hashLicenseKey(n)).not.toContain(n);
    expect(licenseKeyLast5(n)).toBe(key.slice(-5));
  });
});
