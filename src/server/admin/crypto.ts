import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts the platform admins' TOTP secrets at rest (AES-256-GCM, random 96-bit IV, tamper
 * evident). The key lives only in the ADMIN_TOTP_KEY environment variable (32 random bytes,
 * base64), so a database leak alone does not hand out anyone's second factor.
 * Layout: base64( version(1) | iv(12) | tag(16) | ciphertext ). The version byte lets the
 * scheme or key be rotated later.
 */
const VERSION = 1;

function key(): Buffer {
  const raw = process.env.ADMIN_TOTP_KEY;
  if (!raw) throw new Error("ADMIN_TOTP_KEY is not set");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ADMIN_TOTP_KEY must be 32 random bytes, base64-encoded");
  return k;
}

export function encryptSecret(plain: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecret(encoded: string): Buffer {
  const b = Buffer.from(encoded, "base64");
  if (b.length < 30 || b[0] !== VERSION) throw new Error("Unrecognised secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), b.subarray(1, 13));
  decipher.setAuthTag(b.subarray(13, 29));
  return Buffer.concat([decipher.update(b.subarray(29)), decipher.final()]);
}
