import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemo, type DemoResult } from "@/db/seed/demo";
import { TENANT_TABLES } from "@/db/tenant-tables";
import { verifyPassword } from "@/server/auth/password";
import {
  EPHEMERAL_TABLES,
  countsOf,
  exportTenant,
  importTenant,
  insertOrder,
  listTenants,
  type TenantExport,
} from "@/server/backup/tenant-data";

const enabled = !!process.env.DATABASE_URL_OWNER && !!process.env.DATABASE_URL;
const PASSWORD = "violet-lantern-orbit-42";

let client: Client;
beforeAll(async () => {
  if (!enabled) return;
  client = new Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await client.connect();
});
afterAll(async () => {
  if (enabled) await client.end();
});

const seed = (): Promise<DemoResult> => {
  const id = randomBytes(3).toString("hex");
  return seedDemo({
    ownerEmail: `owner@demo-${id}.example`,
    emailDomain: `demo-${id}.example`,
    password: PASSWORD,
  });
};

/** A business's data in a form that can be compared: tables sorted by content. */
async function fingerprint(id: string, skip: string[] = []) {
  const d = await exportTenant(client, id);
  const out: Record<string, string[]> = {};
  for (const [t, rows] of Object.entries(d.tables)) {
    if (skip.includes(t)) continue;
    out[t] = rows.map((r) => JSON.stringify(r)).sort();
  }
  return { tenant: d.tenant, licenses: d.licenses, tables: out };
}

/** Wipes a business completely, the way a disaster would: children first, then the business itself. */
async function wipe(id: string) {
  for (const name of [...(await insertOrder(client))].reverse()) {
    await client.query(`delete from "${name}" where tenant_id = $1`, [id]);
  }
  await client.query("delete from license where tenant_id = $1", [id]);
  await client.query("delete from tenant where id = $1", [id]);
}

describe.skipIf(!enabled)("Per-customer export and restore", () => {
  it("orders the tables parents-first from the database's own foreign keys", async () => {
    const order = await insertOrder(client);
    expect([...order].sort()).toEqual([...TENANT_TABLES].sort());
    const at = (t: string) => order.indexOf(t);
    expect(at("system_user")).toBeLessThan(at("account"));
    expect(at("quote")).toBeLessThan(at("quote_detail"));
    expect(at("work_order")).toBeLessThan(at("resource_booking"));
    expect(at("bookable_resource")).toBeLessThan(at("resource_booking"));
    expect(at("product")).toBeLessThan(at("price_list_item"));
    expect(at("incident")).toBeLessThan(at("work_order"));
  });

  it("exports every table of one business, leaves out sessions and one-time tokens, and nothing of anyone else's", async () => {
    const a = await seed();
    const b = await seed();
    const data = await exportTenant(client, a.tenantId);
    expect(data.format).toBe(1);
    expect(data.tenant.id).toBe(a.tenantId);
    expect(data.licenses).toHaveLength(1);
    for (const t of EPHEMERAL_TABLES) expect(data.tables).not.toHaveProperty(t);
    const counts = countsOf(data);
    expect(counts.account).toBe(12);
    expect(counts.lead).toBe(14);
    expect(counts.system_user).toBe(6);
    expect(counts.resource_booking).toBe(7);
    // Every exported row belongs to this business.
    for (const rows of Object.values(data.tables)) {
      for (const r of rows) expect(r.tenant_id).toBe(a.tenantId);
    }
    expect(JSON.stringify(data)).not.toContain(b.tenantId);
    // The list command shows both.
    const ids = (await listTenants(client)).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([a.tenantId, b.tenantId]));
  });

  it("restores a damaged business exactly, and leaves every other business untouched", async () => {
    const a = await seed();
    const other = await seed();
    const before = await fingerprint(a.tenantId);
    const otherBefore = await fingerprint(other.tenantId);
    const backup = await exportTenant(client, a.tenantId);

    // Disaster: records deleted, edited, and the business renamed.
    await client.query("delete from quote_detail where tenant_id = $1", [a.tenantId]);
    await client.query("delete from quote where tenant_id = $1", [a.tenantId]);
    await client.query("delete from activity where tenant_id = $1", [a.tenantId]);
    await client.query("update lead set topic = 'WRECKED' where tenant_id = $1", [a.tenantId]);
    await client.query("update tenant set name = 'Hacked' where id = $1", [a.tenantId]);
    expect((await fingerprint(a.tenantId)).tables.quote).toHaveLength(0);

    const r = await importTenant(client, backup, { replace: true });
    expect(r).toMatchObject({ tenantId: a.tenantId, replaced: true });

    // Same data as before the disaster (the audit log also gains the "restore" entry).
    const after = await fingerprint(a.tenantId);
    expect(after.tenant).toEqual(before.tenant);
    expect(after.licenses).toEqual(before.licenses);
    for (const t of Object.keys(before.tables)) {
      if (t === "audit_log") continue;
      expect(after.tables[t], t).toEqual(before.tables[t]);
    }
    expect(after.tables.audit_log).toHaveLength(before.tables.audit_log!.length + 1);
    const restoreEntry = (await exportTenant(client, a.tenantId)).tables.audit_log!.find(
      (x) => x.action === "restore",
    );
    expect(restoreEntry).toBeTruthy();

    // The other business did not change at all.
    expect(await fingerprint(other.tenantId)).toEqual(otherBefore);
  });

  it("brings back a business that was deleted entirely, and its people can sign in again", async () => {
    const a = await seed();
    const before = await fingerprint(a.tenantId);
    const backup = await exportTenant(client, a.tenantId);
    await wipe(a.tenantId);
    expect((await client.query("select 1 from tenant where id = $1", [a.tenantId])).rowCount).toBe(
      0,
    );

    const r = await importTenant(client, backup); // no replace needed: it isn't there
    expect(r.replaced).toBe(false);
    const after = await fingerprint(a.tenantId);
    for (const t of Object.keys(before.tables)) {
      if (t === "audit_log") continue;
      expect(after.tables[t], t).toEqual(before.tables[t]);
    }
    const owner = a.people[0]!;
    const row = await client.query('select password_hash from "system_user" where email = $1', [
      owner.email,
    ]);
    expect(await verifyPassword(row.rows[0].password_hash, PASSWORD)).toBe(true);
  });

  it("refuses to overwrite a business that exists unless told to replace, and changes nothing", async () => {
    const a = await seed();
    const backup = await exportTenant(client, a.tenantId);
    const before = await fingerprint(a.tenantId);
    await expect(importTenant(client, backup)).rejects.toThrow(/already exists/);
    expect(await fingerprint(a.tenantId)).toEqual(before);
  });

  it("is all or nothing: a bad file rolls everything back", async () => {
    const a = await seed();
    const backup = await exportTenant(client, a.tenantId);
    const before = await fingerprint(a.tenantId);

    // A row that breaks a foreign key (an account owned by a user who doesn't exist).
    const broken: TenantExport = structuredClone(backup);
    broken.tables.account![0]!.owner_id = "00000000-0000-4000-8000-000000000000";
    await expect(importTenant(client, broken, { replace: true })).rejects.toThrow();
    expect(await fingerprint(a.tenantId)).toEqual(before); // the live data is exactly as it was

    // An unsafe column name in the file is rejected, not run.
    const evil: TenantExport = structuredClone(backup);
    evil.tenant['name"; drop table account; --'] = "x";
    await expect(importTenant(client, evil, { replace: true })).rejects.toThrow(/Unsafe name/);
    expect(await fingerprint(a.tenantId)).toEqual(before);
    expect(
      (
        await client.query("select count(*)::int as n from account where tenant_id = $1", [
          a.tenantId,
        ])
      ).rows[0].n,
    ).toBe(12);
  });

  it("rejects files it can't read safely", async () => {
    const a = await seed();
    const backup = await exportTenant(client, a.tenantId);
    await expect(importTenant(client, { ...backup, format: 2 as never })).rejects.toThrow(
      /can read/,
    );
    await expect(
      importTenant(client, { ...backup, tenant: { ...backup.tenant, id: "nope" } }),
    ).rejects.toThrow(/valid business id/);
    const withSession = structuredClone(backup);
    withSession.tables.session = [];
    await expect(importTenant(client, withSession, { replace: true })).rejects.toThrow(
      /doesn't restore: session/,
    );
    const withUnknown = structuredClone(backup);
    withUnknown.tables.license = [];
    await expect(importTenant(client, withUnknown, { replace: true })).rejects.toThrow(
      /doesn't restore: license/,
    );
    const newer = { ...backup, migrations: (backup.migrations ?? 0) + 5 };
    await expect(importTenant(client, newer, { replace: true })).rejects.toThrow(/newer database/);
    await expect(exportTenant(client, "not-a-uuid")).rejects.toThrow(/valid business id/);
    await expect(exportTenant(client, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(
      /No business/,
    );
  });
});
