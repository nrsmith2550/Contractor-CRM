import { createHash, randomBytes } from "node:crypto";

/**
 * License keys: `CRM-XXXXX-XXXXX-XXXXX-XXXXXC` — 20 random Crockford base32 characters
 * (100 bits from crypto.randomBytes) followed by 1 checksum character (C).
 * The full key is shown once at purchase; only sha256(key) and the last 5 characters are stored.
 */
export const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 20;
const TOTAL_LENGTH = BODY_LENGTH + 1;

function checksumChar(body: string): string {
  let sum = 0;
  // Odd weights (1, 3, 5, ...) are invertible mod 32, so changing any one body character by a
  // non-zero amount always changes the sum mod 32: every single-character typo is caught.
  for (let i = 0; i < body.length; i++) sum += KEY_ALPHABET.indexOf(body[i]!) * (2 * i + 1);
  return KEY_ALPHABET[sum % 32]!;
}

function format(chars: string): string {
  return `CRM-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15)}`;
}

/** Generates a new key. `random` is injectable for tests; it must return N random bytes. */
export function generateLicenseKey(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(BODY_LENGTH);
  let body = "";
  // 256 is a multiple of 32, so `& 31` is unbiased.
  for (const b of bytes) body += KEY_ALPHABET[b & 31];
  return format(body + checksumChar(body));
}

/**
 * Normalizes user input to the 21 raw characters (uppercase, separators and the CRM prefix
 * removed, Crockford look-alikes O→0 and I/L→1). Returns null if it is not well formed.
 * Does NOT verify the checksum; see isValidLicenseKey.
 */
export function normalizeLicenseKey(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, "");
  // The prefix is only stripped when the length proves it is a prefix, because C, R and M are
  // also valid key characters.
  if (s.length === TOTAL_LENGTH + 3 && s.startsWith("CRM")) s = s.slice(3);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (s.length !== TOTAL_LENGTH) return null;
  for (const ch of s) if (!KEY_ALPHABET.includes(ch)) return null;
  return s;
}

/** True only for a well-formed key with a correct checksum. Catches typos before any DB hit. */
export function isValidLicenseKey(input: string): boolean {
  const n = normalizeLicenseKey(input);
  return n !== null && checksumChar(n.slice(0, BODY_LENGTH)) === n[BODY_LENGTH];
}

/** Canonical display form of a normalized key. */
export function canonicalLicenseKey(normalized: string): string {
  return format(normalized);
}

/** sha256 hex of the canonical key: the only form of the key that is stored. */
export function hashLicenseKey(normalized: string): string {
  return createHash("sha256").update(canonicalLicenseKey(normalized)).digest("hex");
}

/** Last 5 characters, for display ("…-7KQ2M"). */
export function licenseKeyLast5(normalized: string): string {
  return normalized.slice(-5);
}
