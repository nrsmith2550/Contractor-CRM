export type HealthResult = {
  ok: boolean;
  db: "ok" | "error" | "not_configured";
};

/** Runs a trivial query through the supplied executor to prove DB connectivity. */
export async function checkDb(run: (() => Promise<unknown>) | null): Promise<HealthResult> {
  if (!run) return { ok: false, db: "not_configured" };
  try {
    await run();
    return { ok: true, db: "ok" };
  } catch {
    return { ok: false, db: "error" };
  }
}
