import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { withTenant } from "@/db/client";
import { incident, opportunity } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { addActivity } from "@/server/domain/activities";
import { createBooking } from "@/server/domain/bookings";
import { createCase } from "@/server/domain/cases";
import { buildCtx } from "@/server/domain/context";
import { createOpportunity } from "@/server/domain/opportunities";
import { createResource } from "@/server/domain/resources";
import { createWorkOrder } from "@/server/domain/work-orders";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function newBusiness() {
  const id = rand();
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Calendar Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "America/New_York",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { email, tenantId: res.tenantId, ownerId: res.userId };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sales Hub" })).toBeVisible();
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

test.describe("dashboards", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("the sales and service dashboards show the business's numbers", async ({ page }) => {
    const { email, tenantId, ownerId } = await newBusiness();
    const c = await buildCtx(tenantId, ownerId);

    ok(await createOpportunity(c, { name: "Big deal", estRevenueCents: 1_250_00 }));
    ok(await createOpportunity(c, { name: "Small deal", estRevenueCents: 250_00 }));
    const won = ok(
      await createOpportunity(c, { name: "Done deal", estRevenueCents: 1 }),
    ).opportunity;
    const today = new Date().toISOString().slice(0, 10);
    await withTenant(tenantId, async (tx) => {
      await tx
        .update(opportunity)
        .set({ status: "won", actualRevenueCents: 4_000_00, actualCloseDate: today })
        .where(eq(opportunity.id, won.id));
    });
    ok(
      await addActivity(c, {
        activityType: "task",
        subject: "Call the supplier",
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );

    const late = ok(await createCase(c, { title: "No heat", priority: "urgent" })).case;
    await withTenant(tenantId, (tx) =>
      tx
        .update(incident)
        .set({ slaDueAt: new Date(Date.now() - 2 * 3_600_000) })
        .where(eq(incident.id, late.id)),
    );
    ok(await createCase(c, { title: "Leaky tap", priority: "low" }));
    const res = ok(await createResource(c, { name: "Crew A" })).resource;
    const wo = ok(await createWorkOrder(c, { title: "Fix furnace" })).workOrder;
    const now = new Date(); // starting now is always "today" in the business's zone
    ok(
      await createBooking(c, {
        workOrderId: wo.id,
        resourceId: res.id,
        startAt: now.toISOString(),
        endAt: new Date(now.getTime() + 3_600_000).toISOString(),
      }),
    );

    await signIn(page, email);

    await page.getByRole("link", { name: "Sales dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Sales dashboard" })).toBeVisible();
    const pipeline = page.getByRole("region", { name: "Open pipeline by stage" });
    await expect(pipeline.getByRole("row", { name: /Qualify\s*2\s*\$1,500\.00/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Won revenue/ })).toContainText("$4,000.00");
    await expect(page.getByRole("region", { name: "Open leads by source" })).toContainText(
      "No open leads.",
    );
    await expect(page.getByRole("region", { name: "My activities" })).toContainText(
      "Call the supplier",
    );

    await page.getByRole("link", { name: "Service dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Service dashboard" })).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Active cases by priority" })
        .getByRole("row", { name: /Urgent\s*1/ }),
    ).toBeVisible();
    const sla = page.getByRole("region", { name: "SLA breaches" });
    await expect(sla).toContainText("SLA breaches (1)");
    await sla.getByRole("link", { name: /No heat/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/cases/${late.id}$`));
    await page.goBack();
    await expect(
      page
        .getByRole("region", { name: "Today's bookings by resource" })
        .getByRole("row", { name: /Crew A\s*1/ }),
    ).toBeVisible();
  });
});
