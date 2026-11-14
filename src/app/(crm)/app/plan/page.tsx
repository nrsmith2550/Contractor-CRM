import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { license } from "@/db/schema";
import { AREAS, AREA_CONTENT, PLANS, SHARED_CONTENT, hasArea, type Area } from "@/lib/plans";
import { requireUser } from "@/server/auth/http";
import { tenantEdition } from "@/server/entities/tenant";

export const metadata: Metadata = { title: "Your plan" };

/** What the business has bought, what that includes, and how to add the rest. */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ needs?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const edition = await tenantEdition(user.tenantId);
  const plan = PLANS[edition];
  const [lic] = await withPlatform((tx) =>
    tx
      .select({ seatLimit: license.seatLimit })
      .from(license)
      .where(and(eq(license.tenantId, user.tenantId), eq(license.status, "active")))
      .limit(1),
  );
  const needs = AREAS.find((a) => a === sp.needs) as Area | undefined;
  const support = process.env.SUPPORT_EMAIL;

  return (
    <>
      <h1>Your plan</h1>
      {needs && !hasArea(edition, needs) && (
        <p role="status" className="crm-warn">
          <strong>{AREA_CONTENT[needs].name}</strong> isn&apos;t part of your plan, so that page
          isn&apos;t available. Here is what you have, and how to add it.
        </p>
      )}
      <p className="home-sub">
        You&apos;re on <strong>{plan.name}</strong>
        {lic ? `, with room for ${lic.seatLimit} people to sign in` : ""}.
      </p>

      <div className="crm-related-grid" style={{ margin: "16px 0" }}>
        {AREAS.map((a) => {
          const included = hasArea(edition, a);
          return (
            <section key={a} className="crm-related-group" aria-labelledby={`plan-${a}`}>
              <h2 id={`plan-${a}`} style={{ margin: "0 0 6px", fontSize: 16 }}>
                {AREA_CONTENT[a].name}{" "}
                <span className={included ? "crm-pill crm-pill-done" : "crm-pill crm-pill-late"}>
                  {included ? "Included" : "Not in your plan"}
                </span>
              </h2>
              <ul>
                {AREA_CONTENT[a].covers.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          );
        })}
        <section className="crm-related-group" aria-labelledby="plan-shared">
          <h2 id="plan-shared" style={{ margin: "0 0 6px", fontSize: 16 }}>
            In every plan
          </h2>
          <ul>
            {SHARED_CONTENT.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      </div>

      {edition !== "complete" && (
        <p>
          To add the other half, move up to <strong>{PLANS.complete.name}</strong>.{" "}
          {support ? (
            <a href={`mailto:${support}?subject=Upgrade my Clinch plan`}>Email us to upgrade</a>
          ) : (
            "Contact us to upgrade."
          )}
        </p>
      )}
      <p>
        <Link href="/app/help/seats-license">About seats and your licence</Link>
      </p>
    </>
  );
}
