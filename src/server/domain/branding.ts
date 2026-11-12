import { eq } from "drizzle-orm";
import { withPlatform, withTenant } from "@/db/client";
import { tenant } from "@/db/schema";
import { can } from "@/server/security/roles";
import { recordAudit } from "./audit";
import { FORBIDDEN, fail, type Ctx, type Result } from "./context";

// The tenant's logo is kept as a small PNG/JPEG data URL on the tenant row, so it needs no
// storage service. It appears on quote PDFs. Only administrators (who can edit security roles)
// may change it.

export const MAX_LOGO_BYTES = 200 * 1024;

const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

/** The real file type from its first bytes, so a renamed file or a spoofed MIME type is refused. */
function sniff(bytes: Buffer): "png" | "jpeg" | null {
  if (
    bytes.length > 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  return null;
}

export function validateLogo(
  dataUrl: unknown,
): { ok: true; dataUrl: string } | { ok: false; message: string } {
  if (typeof dataUrl !== "string") return { ok: false, message: "Choose a PNG or JPEG image." };
  const m = DATA_URL.exec(dataUrl);
  if (!m) return { ok: false, message: "The logo must be a PNG or JPEG image." };
  const bytes = Buffer.from(m[2]!, "base64");
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, message: `The logo must be under ${MAX_LOGO_BYTES / 1024} KB.` };
  }
  const kind = sniff(bytes);
  if (!kind || kind !== m[1])
    return { ok: false, message: "That file isn't a valid PNG or JPEG image." };
  return { ok: true, dataUrl };
}

/** Sets the logo, or clears it when `dataUrl` is null. */
export async function setLogo(ctx: Ctx, dataUrl: string | null): Promise<Result> {
  if (!can(ctx.subject, "security_role", "write")) return FORBIDDEN;
  let value: string | null = null;
  if (dataUrl !== null) {
    const v = validateLogo(dataUrl);
    if (!v.ok) return fail("invalid", v.message);
    value = v.dataUrl;
  }
  await withPlatform((tx) =>
    tx.update(tenant).set({ logoUrl: value }).where(eq(tenant.id, ctx.tenantId)),
  );
  await withTenant(ctx.tenantId, (tx) =>
    recordAudit(tx, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      entity: "tenant",
      recordId: ctx.tenantId,
      action: value ? "set_logo" : "clear_logo",
    }),
  );
  return { ok: true };
}

export async function getLogo(tenantId: string): Promise<string | null> {
  const [t] = await withPlatform((tx) =>
    tx.select({ logo: tenant.logoUrl }).from(tenant).where(eq(tenant.id, tenantId)),
  );
  return t?.logo ?? null;
}
