import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 time-based one-time passwords (HMAC-SHA1, 6 digits, 30-second steps), the format
// every authenticator app understands. Implemented directly so there is nothing to audit but
// ~40 lines, and it is checked against the RFC's published test vectors.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/\s/g, "").replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** 160 random bits, the size RFC 4226 recommends. */
export const generateTotpSecret = (): Buffer => randomBytes(20);

export function totpCode(secret: Uint8Array, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const bin =
    ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const currentStep = (nowMs = Date.now()): number =>
  Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);

const sameCode = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type TotpCheck = { ok: true; step: number } | { ok: false };

/**
 * Accepts the code for the current step or one step either side (clock drift), but never a step
 * at or before `lastStep`: an accepted code is burned, so a shoulder-surfed or intercepted code
 * can't be used again inside its validity window.
 */
export function verifyTotp(args: {
  secret: Uint8Array;
  code: string;
  lastStep?: number | null;
  nowMs?: number;
  window?: number;
}): TotpCheck {
  const code = args.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const now = currentStep(args.nowMs);
  const window = args.window ?? 1;
  let hit: number | null = null;
  // No early exit: every step in the window is always computed.
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (args.lastStep != null && step <= args.lastStep) continue;
    if (sameCode(totpCode(args.secret, step), code) && hit === null) hit = step;
  }
  return hit === null ? { ok: false } : { ok: true, step: hit };
}

/** The `otpauth://` URI an authenticator app imports (shown as a QR code or typed secret). */
export function otpauthUri(args: { email: string; secret: Uint8Array; issuer: string }): string {
  const label = `${encodeURIComponent(args.issuer)}:${encodeURIComponent(args.email)}`;
  const params = new URLSearchParams({
    secret: base32Encode(args.secret),
    issuer: args.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
