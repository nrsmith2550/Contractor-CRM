import { desc, eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { consultationRequest } from "@/db/schema";
import { REQUEST_STATUSES, consultationSchema, type RequestStatus } from "@/lib/consultation";
import { writeAdminAudit } from "@/server/admin/audit";
import { hitRateLimit } from "@/server/auth/rate-limit";

// Consultation requests: an enquiry form on the public site. The visitor gives their details and
// when a call suits; the owner phones them and records what happened. Nothing here books a slot.

/** How often one connection, and one email address, may send a request. */
export const CONSULT_LIMITS = {
  perIp: { max: 5, windowSeconds: 60 * 60 },
  perEmail: { max: 3, windowSeconds: 24 * 60 * 60 },
} as const;

export type ConsultationRow = typeof consultationRequest.$inferSelect;

export type SubmitResult =
  | { ok: true; request: ConsultationRow | null }
  | { ok: false; code: "invalid"; message: string; errors: Record<string, string> }
  | { ok: false; code: "rate_limited"; message: string; errors?: undefined };

/**
 * Checks a request and stores it. A request with the hidden trap field filled in is a bot: it
 * looks successful to the sender but nothing is stored or sent (`request: null`).
 */
export async function submitConsultationRequest(
  raw: unknown,
  ctx: { ip: string },
): Promise<SubmitResult> {
  const parsed = consultationSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??= issue.message;
    }
    return { ok: false, code: "invalid", message: "Please check the highlighted fields.", errors };
  }
  const input = parsed.data;
  if (input.website) return { ok: true, request: null };

  const byIp = await hitRateLimit(`consult:ip:${ctx.ip}`, CONSULT_LIMITS.perIp);
  const byEmail = await hitRateLimit(`consult:email:${input.email}`, CONSULT_LIMITS.perEmail);
  if (!byIp.allowed || !byEmail.allowed) {
    return {
      ok: false,
      code: "rate_limited",
      message: "That is a lot of requests from one place. Please try again later, or email us.",
    };
  }

  const [row] = await withPlatform((tx) =>
    tx
      .insert(consultationRequest)
      .values({
        name: input.name,
        email: input.email,
        phone: input.phone,
        business: input.business,
        trade: input.trade,
        teamSize: input.teamSize,
        bestTime: input.bestTime,
        timeZone: input.timeZone,
        message: input.message || null,
      })
      .returning(),
  );
  return { ok: true, request: row! };
}

/** Newest first. Optionally only one status. */
export async function listConsultationRequests(
  filter: { status?: string } = {},
): Promise<ConsultationRow[]> {
  const status = REQUEST_STATUSES.find((s) => s === filter.status);
  return withPlatform((tx) => {
    const q = tx.select().from(consultationRequest);
    return (status ? q.where(eq(consultationRequest.status, status)) : q)
      .orderBy(desc(consultationRequest.createdAt))
      .limit(200);
  });
}

export async function countNewConsultationRequests(): Promise<number> {
  const rows = await withPlatform((tx) =>
    tx
      .select({ id: consultationRequest.id })
      .from(consultationRequest)
      .where(eq(consultationRequest.status, "new")),
  );
  return rows.length;
}

export type UpdateResult = { ok: true; status: RequestStatus } | { ok: false; message: string };

/** The owner's own tracking: where the request stands, and notes from the call. Audited. */
export async function updateConsultationRequest(
  admin: { adminId: string; ip: string },
  input: { id?: unknown; status?: unknown; notes?: unknown },
): Promise<UpdateResult> {
  const id = typeof input.id === "string" ? input.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, message: "Unknown request." };
  const status = REQUEST_STATUSES.find((s) => s === input.status);
  if (!status) return { ok: false, message: "Choose a status." };
  const notes = typeof input.notes === "string" ? input.notes.trim().slice(0, 2000) : "";

  return withPlatform(async (tx): Promise<UpdateResult> => {
    const [row] = await tx
      .select()
      .from(consultationRequest)
      .where(eq(consultationRequest.id, id))
      .for("update");
    if (!row) return { ok: false, message: "Unknown request." };
    await tx
      .update(consultationRequest)
      .set({
        status,
        notes: notes || null,
        handledAt: status === "new" ? null : (row.handledAt ?? new Date()),
      })
      .where(eq(consultationRequest.id, id));
    await writeAdminAudit(
      {
        adminId: admin.adminId,
        action: "consultation.update",
        targetType: "consultation_request",
        targetId: id,
        reason: `${row.status} -> ${status}`,
        ip: admin.ip,
      },
      tx,
    );
    return { ok: true, status };
  });
}
