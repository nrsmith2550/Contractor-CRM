import { sql } from "drizzle-orm";
import { withPlatform } from "@/db/client";

export const ACTIVATE_LIMIT = { max: 5, windowSeconds: 15 * 60 } as const;
export const LOGIN_LIMIT = { max: 10, windowSeconds: 15 * 60 } as const;

/** Pure decision: attempt number `count` (1-based) is allowed while count <= max. */
export function isAllowed(count: number, max: number): boolean {
  return count <= max;
}

/**
 * Records one attempt against `key` in a Postgres-backed fixed window and reports whether it
 * is allowed. Runs in its own transaction so the count survives even if the caller's work
 * rolls back (failed attempts must still count).
 */
export async function hitRateLimit(
  key: string,
  limit: { max: number; windowSeconds: number },
): Promise<{ allowed: boolean; count: number }> {
  const count = await withPlatform(async (tx) => {
    const res = await tx.execute<{ count: number }>(sql`
      insert into rate_limit (key, window_start, count) values (${key}, now(), 1)
      on conflict (key) do update set
        window_start = case when rate_limit.window_start < now() - make_interval(secs => ${limit.windowSeconds})
                            then now() else rate_limit.window_start end,
        count = case when rate_limit.window_start < now() - make_interval(secs => ${limit.windowSeconds})
                     then 1 else rate_limit.count + 1 end
      returning count`);
    return Number(res.rows[0]!.count);
  });
  return { allowed: isAllowed(count, limit.max), count };
}
