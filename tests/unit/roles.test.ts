import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLES,
  ENTITIES,
  can,
  mergePrivileges,
  type Privileges,
} from "@/server/security/roles";

const role = (name: string): Privileges => DEFAULT_ROLES.find((r) => r.name === name)!.privileges;
const subject = (userId: string, ...names: string[]) => ({
  userId,
  privileges: mergePrivileges(names.map(role)),
});

describe("can()", () => {
  it("seeds the six Dynamics-style roles", () => {
    expect(DEFAULT_ROLES.map((r) => r.name)).toEqual([
      "System Administrator",
      "Sales Manager",
      "Salesperson",
      "Customer Service Rep",
      "Field Technician",
      "Read-only",
    ]);
  });

  it("a salesperson with User-level read cannot open another user's lead", () => {
    const sp = subject("u1", "Salesperson");
    expect(can(sp, "lead", "read", { ownerId: "u1" })).toBe(true);
    expect(can(sp, "lead", "read", { ownerId: "u2" })).toBe(false);
    expect(can(sp, "lead", "read", { ownerId: null })).toBe(false);
    // List-level check (no record) says the user may read leads at all.
    expect(can(sp, "lead", "read")).toBe(true);
  });

  it("organization depth covers every record", () => {
    const mgr = subject("m1", "Sales Manager");
    expect(can(mgr, "lead", "read", { ownerId: "someone-else" })).toBe(true);
    expect(can(mgr, "lead", "assign", { ownerId: "someone-else" })).toBe(true);
  });

  it("create needs a grant but no ownership", () => {
    expect(can(subject("u1", "Salesperson"), "lead", "create")).toBe(true);
    expect(can(subject("u1", "Salesperson"), "case", "create")).toBe(false);
  });

  it("missing grants mean no access", () => {
    const ro = subject("r1", "Read-only");
    expect(can(ro, "lead", "read")).toBe(true);
    expect(can(ro, "lead", "write")).toBe(false);
    expect(can(ro, "license", "read")).toBe(false);
    expect(can(subject("t1", "Field Technician"), "work_order", "delete")).toBe(false);
  });

  it("only System Administrator manages users, roles and the license", () => {
    for (const r of DEFAULT_ROLES) {
      const s = subject("x", r.name);
      const admin = r.name === "System Administrator";
      expect(can(s, "user", "write")).toBe(admin);
      expect(can(s, "security_role", "write")).toBe(admin);
      expect(can(s, "license", "write")).toBe(admin);
    }
  });

  it("merging roles takes the deepest grant", () => {
    const merged = mergePrivileges([role("Salesperson"), role("Field Technician")]);
    expect(merged.lead?.read).toBe("user");
    expect(merged.work_order?.read).toBe("organization");
    const both = mergePrivileges([{ lead: { read: "user" } }, { lead: { read: "organization" } }]);
    expect(both.lead?.read).toBe("organization");
  });

  it("role definitions only reference known entities", () => {
    for (const r of DEFAULT_ROLES) {
      for (const e of Object.keys(r.privileges)) expect(ENTITIES).toContain(e);
    }
  });
});
