import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";

export type Duplicate = {
  kind: "account" | "contact";
  id: string;
  label: string;
  matchedOn: ("email" | "phone" | "name")[];
};

/** Digits only, last 10: "+1 (412) 555-0100" and "412.555.0100" compare equal. */
export function normalizePhone(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

/** Case, punctuation and spacing insensitive: "Acme, Inc." equals "ACME Inc". */
export function normalizeName(n: string | null | undefined): string | null {
  const s = (n ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s === "" ? null : s;
}

const PHONE_SQL = (col: string) =>
  sql.raw(`right(regexp_replace(coalesce(${col}, ''), '\\D', '', 'g'), 10)`);

/**
 * Looks for existing accounts and contacts that match a lead by company name, email or phone.
 * Runs inside the caller's tenant transaction, so it only ever sees this business's records.
 * Matches are advisory: the user decides whether to reuse one or create a new record.
 */
export async function findDuplicates(
  tx: Tx,
  q: { email?: string | null; phone?: string | null; companyName?: string | null },
): Promise<Duplicate[]> {
  const email = q.email?.trim().toLowerCase() || null;
  const phone = normalizePhone(q.phone);
  const name = normalizeName(q.companyName);
  const found = new Map<string, Duplicate>();
  const add = (d: Duplicate) => {
    const key = `${d.kind}:${d.id}`;
    const existing = found.get(key);
    if (existing) existing.matchedOn = [...new Set([...existing.matchedOn, ...d.matchedOn])];
    else found.set(key, d);
  };

  if (name || phone) {
    const rows = await tx.execute<{
      id: string;
      name: string;
      by_name: boolean;
      by_phone: boolean;
    }>(sql`
      select id, name,
             ${name ? sql`lower(trim(regexp_replace(name, '[^a-zA-Z0-9]+', ' ', 'g'))) = ${name}` : sql`false`} as by_name,
             ${phone ? sql`${PHONE_SQL("phone")} = ${phone}` : sql`false`} as by_phone
        from account
       where state_code = 'active'
         and (${name ? sql`lower(trim(regexp_replace(name, '[^a-zA-Z0-9]+', ' ', 'g'))) = ${name}` : sql`false`}
           or ${phone ? sql`${PHONE_SQL("phone")} = ${phone}` : sql`false`})
       limit 10`);
    for (const r of rows.rows) {
      add({
        kind: "account",
        id: r.id,
        label: r.name,
        matchedOn: [
          ...(r.by_name ? (["name"] as const) : []),
          ...(r.by_phone ? (["phone"] as const) : []),
        ],
      });
    }
  }

  if (email || phone) {
    const rows = await tx.execute<{
      id: string;
      first_name: string | null;
      last_name: string;
      by_email: boolean;
      by_phone: boolean;
    }>(sql`
      select id, first_name, last_name,
             ${email ? sql`lower(email) = ${email}` : sql`false`} as by_email,
             ${phone ? sql`(${PHONE_SQL("mobile")} = ${phone} or ${PHONE_SQL("business_phone")} = ${phone})` : sql`false`} as by_phone
        from contact
       where state_code = 'active'
         and (${email ? sql`lower(email) = ${email}` : sql`false`}
           or ${phone ? sql`(${PHONE_SQL("mobile")} = ${phone} or ${PHONE_SQL("business_phone")} = ${phone})` : sql`false`})
       limit 10`);
    for (const r of rows.rows) {
      add({
        kind: "contact",
        id: r.id,
        label: [r.first_name, r.last_name].filter(Boolean).join(" "),
        matchedOn: [
          ...(r.by_email ? (["email"] as const) : []),
          ...(r.by_phone ? (["phone"] as const) : []),
        ],
      });
    }
  }
  return [...found.values()];
}
