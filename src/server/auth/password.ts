import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

// OWASP argon2id minimum: m=19 MiB, t=2, p=1. hash-wasm is WebAssembly, so it also runs on
// Cloudflare Workers (native argon2 addons do not).
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    ...PARAMS,
    outputType: "encoded",
  });
}

export async function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: encodedHash });
  } catch {
    return false;
  }
}

export const MIN_PASSWORD_LENGTH = 12;

// A small embedded blocklist of the most common passwords that satisfy a 12-character minimum
// and obvious keyboard/sequence patterns. Swap in a larger list file later without API change.
const COMMON = new Set([
  "password1234",
  "passw0rd1234",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "qwertyuiopas",
  "qwerty123456",
  "letmein12345",
  "welcome12345",
  "administrator",
  "iloveyou1234",
  "changeme1234",
  "abcdefghijkl",
  "abc123abc123",
  "password123!",
  "password1234!",
  "trustno1trustno1",
  "adminadmin12",
  "admin1234567",
  "monkey123456",
  "dragon123456",
  "football1234",
  "baseball1234",
  "111111111111",
  "000000000000",
]);

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function validatePassword(password: string, context: string[] = []): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > 256) return { ok: false, reason: "That password is too long." };
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password) || lower.includes("password")) {
    return { ok: false, reason: "That password is too common." };
  }
  for (const c of context) {
    const needle = c.toLowerCase().trim();
    if (needle.length >= 4 && lower.includes(needle)) {
      return { ok: false, reason: "Don't include your name, email or company in the password." };
    }
  }
  return { ok: true };
}
