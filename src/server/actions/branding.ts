"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/http";
import { setLogo } from "@/server/domain/branding";
import { buildCtx } from "@/server/domain/context";
import type { CmdResult } from "./entities";

export async function saveLogoAction(dataUrl: string | null): Promise<CmdResult> {
  const u = await requireUser();
  const r = await setLogo(await buildCtx(u.tenantId, u.userId), dataUrl);
  if (!r.ok) return { ok: false, message: r.message };
  revalidatePath("/app", "layout");
  return { ok: true, message: dataUrl ? "Logo saved." : "Logo removed." };
}
