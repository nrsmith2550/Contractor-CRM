import { redirect } from "next/navigation";
import { editionAllowsEntity, hasArea, type Area } from "@/lib/plans";
import { tenantEdition } from "@/server/entities/tenant";
import { requireUser } from "./http";

/**
 * Page guards for the plan the business is on. The real enforcement is in the privileges (see
 * loadSubject), so nothing is reachable by typing an address; this just sends people to a plain
 * explanation instead of an error. Call it before anything else on a page that belongs to one area.
 */
export async function guardArea(area: Area): Promise<void> {
  const user = await requireUser();
  if (!hasArea(await tenantEdition(user.tenantId), area)) redirect(`/app/plan?needs=${area}`);
}

/** Same, for the generic record pages, which know the kind of record rather than the area. */
export async function guardEntity(entity: string): Promise<void> {
  const user = await requireUser();
  if (editionAllowsEntity(await tenantEdition(user.tenantId), entity)) return;
  redirect(`/app/plan?needs=${entity === "case" || entity === "work_order" ? "jobs" : "deals"}`);
}
