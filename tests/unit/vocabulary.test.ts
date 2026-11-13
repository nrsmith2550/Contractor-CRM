import { describe, expect, it } from "vitest";
import { ENTITIES } from "@/entities";
import { NUMBER_PREFIXES, WORDS, humanize, lc, say } from "@/lib/vocabulary";

// What people read on screen is the plain-language vocabulary, defined once in src/lib/vocabulary.ts.

describe("the entity screens use the plain names", () => {
  const BY_KEY = {
    lead: WORDS.lead,
    account: WORDS.account,
    contact: WORDS.contact,
    opportunity: WORDS.opportunity,
    product: WORDS.product,
    case: WORDS.case,
    work_order: WORDS.workOrder,
  } as const;

  it.each(Object.entries(BY_KEY))("%s is called what the vocabulary says", (key, term) => {
    const meta = ENTITIES[key as keyof typeof ENTITIES];
    expect(meta.singular).toBe(term.one);
    expect(meta.plural).toBe(term.many);
  });

  it("uses the new web addresses", () => {
    expect(
      Object.values(ENTITIES)
        .map((e) => e.slug)
        .sort(),
    ).toEqual([
      "customers",
      "deals",
      "jobs",
      "people",
      "products",
      "prospects",
      "support-requests",
    ]);
  });

  it("never shows the old words in a label, column, view or option", () => {
    // "contact" is fine in "Preferred contact method"; the others have no legitimate use on screen.
    const OLD =
      /\b(leads?|accounts?|opportunit(y|ies)|work orders?|cases?|bookings?|resources?|qualif\w*)\b/i;
    const shown: string[] = [];
    for (const m of Object.values(ENTITIES)) {
      shown.push(m.singular, m.plural);
      for (const c of m.columns) shown.push(c.label);
      for (const v of m.views) shown.push(v.label);
      for (const f of m.fields) {
        shown.push(f.label, f.section, f.hint ?? "");
        for (const o of f.options ?? []) shown.push(o.label);
      }
    }
    expect(shown.filter((s) => OLD.test(s))).toEqual([]);
  });
});

describe("how stored values read", () => {
  it("shows plain words for the values whose names changed", () => {
    expect(humanize("qualified")).toBe("Turned into a customer");
    expect(humanize("disqualified")).toBe("Closed");
    expect(humanize("prospect")).toBe("Potential customer");
    expect(humanize("customer")).toBe("Current customer");
  });
  it("capitalises everything else and drops underscores", () => {
    expect(humanize("in_progress")).toBe("In progress");
    expect(humanize("waiting_on_customer")).toBe("Waiting on customer");
    expect(humanize("urgent")).toBe("Urgent");
  });
  it("reads naturally inside a sentence", () => {
    expect(say("qualified")).toBe("already a customer");
    expect(say("disqualified")).toBe("closed");
    expect(say("on_hold")).toBe("on hold");
    expect(lc(WORDS.case.one)).toBe("support request");
  });
});

describe("record numbers", () => {
  it("use readable prefixes, all different", () => {
    expect(NUMBER_PREFIXES).toEqual({
      lead: "PROS",
      account: "CUST",
      contact: "PERS",
      opportunity: "DEAL",
      case: "REQ",
      work_order: "JOB",
    });
    expect(new Set(Object.values(NUMBER_PREFIXES)).size).toBe(6);
  });
});
