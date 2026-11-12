/**
 * Optional IP allowlist for the admin console (ADMIN_IP_ALLOWLIST, comma-separated IPv4/IPv6
 * addresses or IPv4 CIDR ranges). Empty or unset means "no restriction": the allowlist is an
 * extra layer on top of password + TOTP, not a replacement for them.
 */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
};

function matches(ip: string, rule: string): boolean {
  if (!rule.includes("/")) return ip === rule;
  const [base, bitsRaw] = rule.split("/");
  const bits = Number(bitsRaw);
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base ?? "");
  if (a === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (a & mask) >>> 0 === (b & mask) >>> 0;
}

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  return allowlist.some((rule) => matches(ip, rule));
}
