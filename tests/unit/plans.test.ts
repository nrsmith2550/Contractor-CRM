import { describe, expect, it } from "vitest";
import {
  AREAS,
  EDITIONS,
  ENTITY_AREA,
  PLANS,
  USERS_INCLUDED,
  editionAllowsEntity,
  firstYearCents,
  hasArea,
  isEdition,
  limitToEdition,
} from "@/lib/plans";
import { DEFAULT_ROLES, ENTITIES, type Privileges } from "@/server/security/roles";

describe("plans", () => {
  it("prices are the agreed ones: a setup fee, then a monthly fee", () => {
    expect(PLANS.complete).toMatchObject({ setupCents: 50_000, monthlyCents: 7_000 });
    expect(PLANS.deals).toMatchObject({ setupCents: 30_000, monthlyCents: 4_500 });
    expect(PLANS.jobs).toMatchObject({ setupCents: 30_000, monthlyCents: 4_500 });
    expect(PLANS.complete.name).toBe("Gantry Complete");
    expect(PLANS.deals.name).toBe("Gantry Deals");
    expect(PLANS.jobs.name).toBe("Gantry Jobs");
    expect(USERS_INCLUDED).toBe(10);
  });

  it("the full suite is cheaper than buying both halves", () => {
    expect(PLANS.complete.setupCents).toBeLessThan(PLANS.deals.setupCents + PLANS.jobs.setupCents);
    expect(PLANS.complete.monthlyCents).toBeLessThan(
      PLANS.deals.monthlyCents + PLANS.jobs.monthlyCents,
    );
    expect(firstYearCents("complete")).toBe(50_000 + 12 * 7_000);
  });

  it("each plan covers the right areas", () => {
    expect(PLANS.complete.areas).toEqual(["deals", "jobs"]);
    expect(PLANS.deals.areas).toEqual(["deals"]);
    expect(PLANS.jobs.areas).toEqual(["jobs"]);
    expect(hasArea("deals", "jobs")).toBe(false);
    expect(hasArea("jobs", "deals")).toBe(false);
    expect(EDITIONS.every((e) => isEdition(e))).toBe(true);
    expect(isEdition("platinum")).toBe(false);
    expect(AREAS).toEqual(["deals", "jobs"]);
  });

  it("every entity that belongs to an area is a real entity; the rest are shared", () => {
    for (const e of Object.keys(ENTITY_AREA)) expect(ENTITIES as readonly string[]).toContain(e);
    for (const shared of ["account", "contact", "product", "price_list", "activity", "note"]) {
      for (const ed of EDITIONS) expect(editionAllowsEntity(ed, shared)).toBe(true);
    }
    expect(editionAllowsEntity("deals", "case")).toBe(false);
    expect(editionAllowsEntity("jobs", "lead")).toBe(false);
    expect(editionAllowsEntity("jobs", "quote")).toBe(false);
    expect(editionAllowsEntity("complete", "booking")).toBe(true);
  });

  it("limiting privileges removes only the other area's entities", () => {
    const admin = DEFAULT_ROLES[0]!.privileges;
    const deals = limitToEdition(admin, "deals") as Privileges;
    expect(Object.keys(deals)).toEqual(
      expect.arrayContaining(["lead", "opportunity", "quote", "order", "account", "user"]),
    );
    for (const gone of ["case", "work_order", "booking"]) expect(deals).not.toHaveProperty(gone);
    const jobs = limitToEdition(admin, "jobs") as Privileges;
    for (const gone of ["lead", "opportunity", "quote", "order"])
      expect(jobs).not.toHaveProperty(gone);
    expect(jobs.case?.read).toBe("organization");
    // The full suite loses nothing, and the input is never changed.
    expect(limitToEdition(admin, "complete")).toEqual(admin);
    expect(admin).toHaveProperty("case");
  });
});
