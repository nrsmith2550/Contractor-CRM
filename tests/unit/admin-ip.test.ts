import { describe, expect, it } from "vitest";
import { isIpAllowed, parseAllowlist } from "@/server/admin/ip";

describe("admin IP allowlist", () => {
  it("allows everyone when no allowlist is configured", () => {
    expect(isIpAllowed("203.0.113.9", parseAllowlist(undefined))).toBe(true);
    expect(isIpAllowed("203.0.113.9", parseAllowlist("  ,  "))).toBe(true);
  });

  it("parses a comma-separated list", () => {
    expect(parseAllowlist(" 1.2.3.4 , 10.0.0.0/8,,::1 ")).toEqual(["1.2.3.4", "10.0.0.0/8", "::1"]);
  });

  it("matches exact addresses (IPv4 and IPv6) and nothing else", () => {
    const list = parseAllowlist("203.0.113.9,2001:db8::1");
    expect(isIpAllowed("203.0.113.9", list)).toBe(true);
    expect(isIpAllowed("2001:db8::1", list)).toBe(true);
    expect(isIpAllowed("203.0.113.10", list)).toBe(false);
    expect(isIpAllowed("unknown", list)).toBe(false);
  });

  it("matches IPv4 CIDR ranges at their boundaries", () => {
    const list = parseAllowlist("198.51.100.0/24,10.1.0.0/16,192.0.2.5/32");
    expect(isIpAllowed("198.51.100.0", list)).toBe(true);
    expect(isIpAllowed("198.51.100.255", list)).toBe(true);
    expect(isIpAllowed("198.51.101.0", list)).toBe(false);
    expect(isIpAllowed("10.1.200.3", list)).toBe(true);
    expect(isIpAllowed("10.2.0.1", list)).toBe(false);
    expect(isIpAllowed("192.0.2.5", list)).toBe(true);
    expect(isIpAllowed("192.0.2.6", list)).toBe(false);
  });

  it("fails closed on malformed rules and addresses", () => {
    expect(isIpAllowed("1.2.3.4", ["1.2.3.4/33"])).toBe(false);
    expect(isIpAllowed("1.2.3.4", ["nonsense/8"])).toBe(false);
    expect(isIpAllowed("999.1.1.1", ["999.1.1.1/8"])).toBe(false);
    expect(isIpAllowed("not-an-ip", ["10.0.0.0/8"])).toBe(false);
  });
});
