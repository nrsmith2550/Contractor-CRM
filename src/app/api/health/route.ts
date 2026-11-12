import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { checkDb } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const result = await checkDb(db ? () => db.execute(sql`select 1`) : null);
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
