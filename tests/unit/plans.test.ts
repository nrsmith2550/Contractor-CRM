import { describe, expect, it } from "vitest";
import {
  AREAS,
  EDITIONS,
  ENTITY_AREA,
  PLANS,
  MAX_EXTRA_USERS,
  MAX_SELF_SERVE_USERS,
  USERS_INCLUDED,
  extraUsersFor,
  isValidExtraUsers,
  monthlyCentsFor,
  seatsFor,
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

  describe("more than 10 people", () => {
    it("extra people cost $5 a month on Complete and $3 on Deals or Jobs, up to 50 in total", () => {
      expect(PLANS.complete.extraUserCents).toBe(500);
      expect(PLANS.deals.extraUserCents).toBe(300);
      expect(PLANS.jobs.extraUserCents).toBe(300);
      expect(MAX_SELF_SERVE_USERS).toBe(50);
      expect(MAX_EXTRA_USERS).toBe(40);
    });

    it("works out the monthly price and the seats", () => {
      expect(monthlyCentsFor("complete")).toBe(7_000);
      expect(monthlyCentsFor("complete", 15)).toBe(7_000 + 15 * 500); // 25 people: $145
      expect(monthlyCentsFor("deals", 15)).toBe(4_500 + 15 * 300); // $90
      expect(monthlyCentsFor("jobs", MAX_EXTRA_USERS)).toBe(4_500 + 40 * 300); // 50 people: $165
      expect(monthlyCentsFor("complete", MAX_EXTRA_USERS)).toBe(27_000); // 50 people: $270
      expect(seatsFor(0)).toBe(10);
      expect(seatsFor(15)).toBe(25);
      expect(extraUsersFor(10)).toBe(0);
      expect(extraUsersFor(3)).toBe(0);
      expect(extraUsersFor(25)).toBe(15);
    });

    it("only accepts a whole number of extra people from 0 to 40", () => {
      for (const ok of [0, 1, 15, 40]) expect(isValidExtraUsers(ok)).toBe(true);
      for (const bad of [-1, 41, 1.5, NaN, "5", null, undefined, Infinity])
        expect(isValidExtraUsers(bad)).toBe(false);
    });

    it("the full suite is the better deal at every size, and growing is rewarded", () => {
      for (let extra = 0; extra <= MAX_EXTRA_USERS; extra++) {
        const both = monthlyCentsFor("deals", extra) + monthlyCentsFor("jobs", extra);
        expect(monthlyCentsFor("complete", extra)).toBeLessThan(both);
      }
      // An extra person is cheaper than the plan's own rate per included person.
      for (const e of EDITIONS) {
        expect(PLANS[e].extraUserCents).toBeLessThan(PLANS[e].monthlyCents / USERS_INCLUDED);
      }
      // And the price rises with every person added.
      for (const e of EDITIONS) {
        for (let extra = 1; extra <= MAX_EXTRA_USERS; extra++) {
          expect(monthlyCentsFor(e, extra)).toBeGreaterThan(monthlyCentsFor(e, extra - 1));
        }
      }
    });
  });
});
