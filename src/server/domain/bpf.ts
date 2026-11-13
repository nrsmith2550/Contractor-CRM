// The opportunity business process flow: Qualify → Develop → Propose → Close. Each stage has
// fields that must be filled in before the record may leave it. Pure and unit-tested.

export const STAGES = ["qualify", "develop", "propose", "close"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  qualify: "Qualify",
  develop: "Develop",
  propose: "Propose",
  close: "Close",
};

/** Typical win probability at each stage; the user can still override it. */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  qualify: 10,
  develop: 25,
  propose: 50,
  close: 75,
};

export type OpportunitySnapshot = {
  name: string | null;
  customerAccountId: string | null;
  customerContactId: string | null;
  estCloseDate: string | null;
  estRevenueCents: number | null;
  budgetCents: number | null;
  purchaseTimeframe: string | null;
  proposalDelivered: boolean | null;
};

type Requirement = {
  field: keyof OpportunitySnapshot;
  label: string;
  ok: (o: OpportunitySnapshot) => boolean;
};

const filled = (v: string | null) => v !== null && v.trim() !== "";

/** What must be true to LEAVE each stage. The last stage is left by closing as won or lost. */
export const REQUIRED_TO_LEAVE: Record<Stage, Requirement[]> = {
  qualify: [
    { field: "name", label: "Topic", ok: (o) => filled(o.name) },
    { field: "customerAccountId", label: "Customer", ok: (o) => o.customerAccountId !== null },
    { field: "estCloseDate", label: "Estimated close date", ok: (o) => filled(o.estCloseDate) },
  ],
  develop: [
    {
      field: "customerContactId",
      label: "Decision-maker",
      ok: (o) => o.customerContactId !== null,
    },
    {
      field: "budgetCents",
      label: "Budget",
      ok: (o) => o.budgetCents !== null && o.budgetCents > 0,
    },
    {
      field: "purchaseTimeframe",
      label: "Purchase timeframe",
      ok: (o) => filled(o.purchaseTimeframe),
    },
  ],
  propose: [
    {
      field: "estRevenueCents",
      label: "Estimated revenue",
      ok: (o) => o.estRevenueCents !== null && o.estRevenueCents > 0,
    },
    {
      field: "proposalDelivered",
      label: "Proposal delivered",
      ok: (o) => o.proposalDelivered === true,
    },
  ],
  close: [],
};

export function missingFields(
  o: OpportunitySnapshot,
  leaving: Stage,
): { field: string; label: string }[] {
  return REQUIRED_TO_LEAVE[leaving]
    .filter((r) => !r.ok(o))
    .map(({ field, label }) => ({ field, label }));
}

export const nextStage = (s: Stage): Stage | null => STAGES[STAGES.indexOf(s) + 1] ?? null;

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export type MoveCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "same" | "skip" | "missing_fields";
      missing?: { field: string; label: string }[];
    };

/**
 * Stages advance one step at a time and only once the current stage's required fields are
 * filled; moving back to any earlier stage is always allowed.
 */
export function canMove(o: OpportunitySnapshot, from: Stage, to: Stage): MoveCheck {
  const a = STAGES.indexOf(from);
  const b = STAGES.indexOf(to);
  if (a === b) return { ok: false, reason: "same" };
  if (b < a) return { ok: true };
  if (b > a + 1) return { ok: false, reason: "skip" };
  const missing = missingFields(o, from);
  return missing.length === 0 ? { ok: true } : { ok: false, reason: "missing_fields", missing };
}
