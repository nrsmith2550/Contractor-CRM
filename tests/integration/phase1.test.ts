import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withPlatform, withTenant } from "@/db/client";
import {
  adminAuditLog,
  auditLog,
  authEvent,
  license,
  securityRole,
  sequence,
  session,
  systemUser,
  userRole,
} from "@/db/schema";
import { TENANT_TABLES } from "@/db/tenant-tables";
import { activateLicense } from "@/server/auth/activation";
import { generateLicenseKey, hashLicenseKey, normalizeLicenseKey } from "@/server/auth/license-key";
import { createSession, validateSession } from "@/server/auth/session";
import { mintLicense } from "@/server/licensing/mint";

const enabled = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL_OWNER);
const rand = () => randomBytes(5).toString("hex");
const PASSWORD = "violet-lantern-orbit-42";

function form(key: string, overrides: Record<string, unknown> = {}) {
  const id = rand();
  return {
    licenseKey: key,
    companyName: `Acme ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: `owner-${id}@example.test`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "America/New_York",
    currency: "USD",
    ip: `ip-${id}`,
    ...overrides,
  };
}

const keyHash = (key: string) => hashLicenseKey(normalizeLicenseKey(key)!);
const badChecksum = (key: string) => key.slice(0, -1) + (key.endsWith("0") ? "1" : "0");

async function newTenant() {
  const { key } = await mintLicense({ tier: "team" });
  const input = form(key);
  const res = await activateLicense(input);
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { key, input, tenantId: res.tenantId, userId: res.userId };
}

const errorChain = (e: unknown): string => {
  const parts: string[] = [];
  for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) {
    parts.push(String((x as { message?: unknown }).message ?? x));
  }
  return parts.join(" | ");
};

describe.skipIf(!enabled)("Phase 1 — licensing, auth, tenancy (real Postgres)", () => {
  it("a minted key activates once: creates tenant, owner, roles, sequences; key becomes active", async () => {
    const { key } = await mintLicense({ tier: "team", buyerEmail: "buyer@example.test" });
    const input = form(key);
    const res = await activateLicense(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    await withTenant(res.tenantId, async (tx) => {
      const [owner] = await tx.select().from(systemUser);
      expect(owner!.email).toBe(input.ownerEmail);
      expect(owner!.isOwner).toBe(true);
      expect(owner!.mustChangePassword).toBe(false);
      // Password is stored as an argon2id hash, never in plain text.
      expect(owner!.passwordHash.startsWith("$argon2id$")).toBe(true);
      expect(owner!.passwordHash).not.toContain(PASSWORD);

      const roles = await tx.select({ name: securityRole.name }).from(securityRole);
      expect(roles.map((r) => r.name).sort()).toEqual(
        [
          "Customer Service Rep",
          "Field Technician",
          "Read-only",
          "Sales Manager",
          "Salesperson",
          "System Administrator",
        ].sort(),
      );
      const [link] = await tx
        .select({ name: securityRole.name })
        .from(userRole)
        .innerJoin(securityRole, eq(userRole.roleId, securityRole.id));
      expect(link!.name).toBe("System Administrator");

      expect((await tx.select().from(sequence)).map((s) => s.prefix)).toContain("PROS");
      const [audit] = await tx.select().from(auditLog).where(eq(auditLog.action, "activate"));
      expect(audit).toBeTruthy();
      // The audit entry records the last 5 characters only, never the key.
      expect(JSON.stringify(audit)).not.toContain(normalizeLicenseKey(key)!);
    });

    const [lic] = await withPlatform((tx) =>
      tx
        .select()
        .from(license)
        .where(eq(license.keyHash, keyHash(key))),
    );
    expect(lic!.status).toBe("active");
    expect(lic!.tenantId).toBe(res.tenantId);
    expect(lic!.activatedAt).toBeInstanceOf(Date);
  });

  it("a second activation attempt is refused and points to login with a masked email", async () => {
    const { key, input } = await newTenant();
    const again = await activateLicense(form(key));
    expect(again).toMatchObject({ ok: false, code: "already_active" });
    if (again.ok) return;
    expect(again.emailHint).toBe("o***@example.test");
    expect(again.emailHint).not.toContain(input.ownerEmail);
  });

  it("rejects malformed keys, bad checksums and unknown-but-well-formed keys", async () => {
    expect(await activateLicense(form("not-a-key"))).toMatchObject({
      ok: false,
      code: "invalid_key",
    });

    const { key } = await mintLicense({ tier: "starter" });
    expect(await activateLicense(form(badChecksum(key)))).toMatchObject({
      ok: false,
      code: "invalid_key",
    });

    // Valid checksum but never minted.
    expect(await activateLicense(form(generateLicenseKey()))).toMatchObject({
      ok: false,
      code: "invalid_key",
    });
  });

  it("rate-limits activation: the 6th attempt in 15 minutes is blocked", async () => {
    const bad = badChecksum(generateLicenseKey()); // fresh random prefix each run
    const ip = `ip-rl-${rand()}`;
    for (let i = 1; i <= 5; i++) {
      expect(await activateLicense(form(bad, { ip }))).toMatchObject({
        ok: false,
        code: "invalid_key",
      });
    }
    expect(await activateLicense(form(bad, { ip }))).toMatchObject({
      ok: false,
      code: "rate_limited",
    });
    // A different IP and a different key prefix is unaffected.
    const other = await activateLicense(
      form(badChecksum(generateLicenseKey()), { ip: `ip-rl-${rand()}` }),
    );
    expect(other).toMatchObject({ ok: false, code: "invalid_key" });
  });

  it("logs failures without ever storing the key or password", async () => {
    const ip = `ip-log-${rand()}`;
    await activateLicense(form("CRM-AAAAA-AAAAA-AAAAA-AAAAAA", { ip }));
    const rows = await withPlatform((tx) =>
      tx.select().from(authEvent).where(eq(authEvent.ip, ip)),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("AAAAA-AAAAA");
    expect(JSON.stringify(rows)).not.toContain(PASSWORD);
  });

  it("refuses weak passwords and leaves the key unused", async () => {
    const { key } = await mintLicense({ tier: "starter" });
    expect(
      await activateLicense(
        form(key, { password: "password1234", confirmPassword: "password1234" }),
      ),
    ).toMatchObject({ ok: false, code: "weak_password" });
    expect(
      await activateLicense(form(key, { confirmPassword: "different-password-99" })),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    // Still activatable afterwards.
    expect((await activateLicense(form(key))).ok).toBe(true);
  });

  it("refuses an email that already has an account, and rolls the whole activation back", async () => {
    const first = await newTenant();
    const { key } = await mintLicense({ tier: "starter" });
    const res = await activateLicense(form(key, { ownerEmail: first.input.ownerEmail }));
    expect(res).toMatchObject({ ok: false, code: "email_taken" });
    const [lic] = await withPlatform((tx) =>
      tx
        .select()
        .from(license)
        .where(eq(license.keyHash, keyHash(key))),
    );
    expect(lic!.status).toBe("issued");
    expect(lic!.tenantId).toBeNull();
  });

  it("suspended or revoked keys cannot be activated", async () => {
    for (const status of ["suspended", "revoked"] as const) {
      const { key, licenseId } = await mintLicense({ tier: "starter" });
      await withPlatform((tx) =>
        tx.update(license).set({ status }).where(eq(license.id, licenseId)),
      );
      expect(await activateLicense(form(key))).toMatchObject({ ok: false, code: "unavailable" });
    }
  });

  it("suspending a license signs the tenant out on its next request", async () => {
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const ok = await validateSession(token);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.user).toMatchObject({ tenantId: t.tenantId, isOwner: true });

    await withPlatform((tx) =>
      tx.update(license).set({ status: "suspended" }).where(eq(license.tenantId, t.tenantId)),
    );
    expect(await validateSession(token)).toEqual({ ok: false, reason: "license_inactive" });

    await withPlatform((tx) =>
      tx.update(license).set({ status: "active" }).where(eq(license.tenantId, t.tenantId)),
    );
    expect((await validateSession(token)).ok).toBe(true);
    expect(await validateSession("not-a-real-token")).toEqual({ ok: false, reason: "missing" });
    expect(await validateSession(undefined)).toEqual({ ok: false, reason: "missing" });
  });

  it("stores only the session token hash", async () => {
    const t = await newTenant();
    const { token } = await createSession({ tenantId: t.tenantId, userId: t.userId });
    const rows = await withTenant(t.tenantId, (tx) => tx.select().from(session));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  describe("tenant isolation", () => {
    it("tenant A sees zero tenant B rows in every tenant table", async () => {
      const a = await newTenant();
      const b = await newTenant();
      await createSession({ tenantId: a.tenantId, userId: a.userId });
      await createSession({ tenantId: b.tenantId, userId: b.userId });

      for (const [me, other] of [
        [a, b],
        [b, a],
      ] as const) {
        await withTenant(me.tenantId, async (tx) => {
          const users = await tx.select().from(systemUser);
          expect(users.map((u) => u.tenantId)).toEqual([me.tenantId]);
          for (const table of [securityRole, userRole, auditLog, sequence, session]) {
            const rows = (await tx.select().from(table)) as { tenantId: string }[];
            expect(rows.length).toBeGreaterThan(0);
            expect(rows.every((r) => r.tenantId === me.tenantId)).toBe(true);
          }
          // Reading the other tenant's rows by primary key returns nothing.
          const direct = await tx.select().from(systemUser).where(eq(systemUser.id, other.userId));
          expect(direct).toEqual([]);
        });
      }
    });

    it("cannot write or update across tenants", async () => {
      const a = await newTenant();
      const b = await newTenant();

      // Insert as tenant A with tenant B's id: RLS WITH CHECK rejects it.
      await expect(
        withTenant(a.tenantId, (tx) =>
          tx.insert(auditLog).values({ tenantId: b.tenantId, entity: "x", action: "inject" }),
        ),
      ).rejects.toSatisfy((e: unknown) => /row-level security/i.test(errorChain(e)));

      // Update/delete B's rows from A's context affects nothing.
      await withTenant(a.tenantId, async (tx) => {
        const upd = await tx
          .update(systemUser)
          .set({ fullName: "hacked" })
          .where(eq(systemUser.id, b.userId))
          .returning();
        expect(upd).toEqual([]);
        const del = await tx.delete(session).where(eq(session.tenantId, b.tenantId)).returning();
        expect(del).toEqual([]);
      });
      const [bUser] = await withTenant(b.tenantId, (tx) =>
        tx.select().from(systemUser).where(eq(systemUser.id, b.userId)),
      );
      expect(bUser!.fullName).toBe("Jordan Rivers");
    });

    it("with no tenant pinned, tenant tables are empty and not writable", async () => {
      await newTenant();
      await withPlatform(async (tx) => {
        for (const table of [systemUser, securityRole, userRole, auditLog, sequence, session]) {
          expect(await tx.select().from(table)).toEqual([]);
        }
      });
      await expect(
        withPlatform((tx) =>
          tx.insert(auditLog).values({
            tenantId: "00000000-0000-0000-0000-000000000000",
            entity: "x",
            action: "inject",
          }),
        ),
      ).rejects.toBeTruthy();
    });

    it("every table with a tenant_id column has RLS enabled and is registered", async () => {
      const { tablesWithTenantId, rlsTables } = await withPlatform(async (tx) => {
        const cols = await tx.execute<{ table_name: string }>(sql`
          select c.table_name from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'tenant_id'
            and t.table_type = 'BASE TABLE'`);
        const rls = await tx.execute<{ relname: string }>(sql`
          select relname from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity`);
        return {
          tablesWithTenantId: cols.rows.map((r) => r.table_name),
          rlsTables: rls.rows.map((r) => r.relname),
        };
      });
      // `license.tenant_id` is the binding to a tenant, not row ownership: it is a platform table.
      const expected = tablesWithTenantId.filter((t) => t !== "license").sort();
      expect(expected).toEqual([...TENANT_TABLES].sort());
      for (const t of TENANT_TABLES) expect(rlsTables).toContain(t);
    });
  });

  it("the pre-auth lookup function resolves a user case-insensitively and nothing else", async () => {
    const t = await newTenant();
    const res = await withPlatform((tx) =>
      tx.execute<{ user_id: string; tenant_id: string; license_status: string }>(
        sql`select * from auth_find_user_by_email(${t.input.ownerEmail.toUpperCase()})`,
      ),
    );
    expect(res.rows[0]).toMatchObject({
      user_id: t.userId,
      tenant_id: t.tenantId,
      license_status: "active",
    });
    const none = await withPlatform((tx) =>
      tx.execute(sql`select * from auth_find_user_by_email(${"nobody@example.test"})`),
    );
    expect(none.rows).toEqual([]);
  });

  it("admin_audit_log is append-only for the app role", async () => {
    const id = await withPlatform(async (tx) => {
      const [row] = await tx
        .insert(adminAuditLog)
        .values({ action: "test", targetType: "license", reason: "immutability test" })
        .returning({ id: adminAuditLog.id });
      return row!.id;
    });
    await expect(
      withPlatform((tx) =>
        tx.update(adminAuditLog).set({ action: "tampered" }).where(eq(adminAuditLog.id, id)),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withPlatform((tx) => tx.delete(adminAuditLog).where(eq(adminAuditLog.id, id))),
    ).rejects.toBeTruthy();
  });
});
