import { describe, expect, it } from "vitest";
import { ENTITIES, entityBySlug, recordTitle } from "@/entities";

describe("entity metadata", () => {
  const metas = Object.values(ENTITIES);

  it("has unique slugs that resolve back to the entity", () => {
    expect(new Set(metas.map((m) => m.slug)).size).toBe(metas.length);
    for (const m of metas) expect(entityBySlug(m.slug)).toBe(m);
  });

  it("has unique field names and select fields always have options", () => {
    for (const m of metas) {
      const names = m.fields.map((f) => f.name);
      expect(new Set(names).size, m.key).toBe(names.length);
      for (const f of m.fields) {
        if (f.type === "select") expect(f.options?.length, `${m.key}.${f.name}`).toBeGreaterThan(0);
        if (f.type === "lookup") expect(f.lookup, `${m.key}.${f.name}`).toBeDefined();
      }
    }
  });

  it("only references fields that exist in headers and the default view", () => {
    for (const m of metas) {
      const names = new Set(
        m.fields
          .map((f) => f.name)
          .concat(
            m.columns.map((c) => c.name),
            ["status", "stage"],
          ),
      );
      for (const h of m.headerFields) expect(names.has(h), `${m.key}.${h}`).toBe(true);
      expect(
        m.views.some((v) => v.id === m.defaultView),
        m.key,
      ).toBe(true);
    }
  });

  it("names money fields in cents and builds record titles", () => {
    for (const m of metas)
      for (const f of m.fields.filter((x) => x.type === "money"))
        expect(f.name.endsWith("Cents")).toBe(true);
    expect(recordTitle(ENTITIES.contact, { firstName: "Ada", lastName: "Lovelace" })).toBe(
      "Ada Lovelace",
    );
    expect(recordTitle(ENTITIES.account, { name: "", accountNumber: "ACC-1" })).toBe("ACC-1");
  });
});
