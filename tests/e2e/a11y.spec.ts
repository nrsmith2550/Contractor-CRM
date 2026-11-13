import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { createAccount } from "@/server/domain/accounts";
import { addActivity } from "@/server/domain/activities";
import { createBooking } from "@/server/domain/bookings";
import { createCase } from "@/server/domain/cases";
import { buildCtx } from "@/server/domain/context";
import { createLead } from "@/server/domain/leads";
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

// Lighthouse's accessibility score is made from axe-core rules, so running axe itself (with the
// WCAG 2.2 A/AA and best-practice rule sets) on the signed-in pages is the same check, and it
// can run inside the test suite. Every page must have zero violations in both themes.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
}

test.describe("accessibility", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("public and signed-in pages have no axe violations in light or dark", async ({ page }) => {
    test.setTimeout(240_000);
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, tenantId, ownerId } = await newBusiness();
    const c = await buildCtx(tenantId, ownerId);
    const lead = await createLead(c, {
      lastName: "Rivers",
      companyName: "Acme",
      email: "a@acme.test",
      phone: "412-555-0100",
      leadSource: "web",
    });
    await createAccount(c, { name: "Northwind Plumbing" });
    await createOpportunity(c, { name: "Big deal", estRevenueCents: 500_000 });
    const k = await createCase(c, { title: "No heat", priority: "urgent" });
    await addActivity(c, {
      activityType: "task",
      subject: "Call the supplier",
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const res = await createResource(c, { name: "Crew A", userId: ownerId });
    const wo = await createWorkOrder(c, { title: "Fix furnace" });
    if (res.ok && wo.ok) {
      const now = new Date();
      await createBooking(c, {
        workOrderId: wo.workOrder.id,
        resourceId: res.resource.id,
        startAt: now.toISOString(),
        endAt: new Date(now.getTime() + 3_600_000).toISOString(),
      });
    }

    const pages = [
      "/app",
      "/app/prospects?view=all_open",
      "/app/prospects/new",
      lead.ok ? `/app/prospects/${lead.lead.id}` : "/app/prospects",
      "/app/prospects/import",
      "/app/customers?view=all",
      "/app/people",
      "/app/deals?view=open",
      "/app/pipeline",
      "/app/quotes",
      "/app/orders",
      "/app/products",
      "/app/pricing",
      "/app/support-requests?view=all_active",
      k.ok ? `/app/support-requests/${k.case.id}` : "/app/support-requests",
      "/app/jobs",
      wo.ok ? `/app/jobs/${wo.workOrder.id}` : "/app/jobs",
      "/app/team",
      "/app/schedule",
      "/app/my-visits",
      "/app/calendar",
      "/app/dashboards/sales",
      "/app/dashboards/service",
      "/app/search?q=acme",
      "/app/settings/users",
      "/app/settings/tax-rates",
      "/app/settings/branding",
      "/app/settings/service",
      "/app/help",
      "/app/help?q=quote",
      "/app/help/quotes",
      "/app/help/due-times",
      "/app/help/who-can-do-what",
      "/app/help/record-lifecycles",
      "/app/help/how-it-works",
      "/app/help/words-we-use",
    ];

    const found: Record<string, unknown> = {};
    for (const theme of ["light", "dark"] as const) {
      await page
        .context()
        .addCookies([{ name: "clinch-theme", value: theme, url: "http://localhost:3000" }]);
      for (const p of ["/login", "/forgot-password", "/activate", "/"]) {
        await page.goto(p);
        await page.waitForLoadState("networkidle");
        const v = await violations(page);
        if (v.length) found[`${theme} ${p}`] = v;
      }
    }
    await signIn(page, email);
    for (const theme of ["light", "dark"] as const) {
      await page
        .context()
        .addCookies([{ name: "clinch-theme", value: theme, url: "http://localhost:3000" }]);
      for (const p of pages) {
        await page.goto(p);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const v = await violations(page);
        if (v.length) found[`${theme} ${p}`] = v;
      }
    }
    expect(found).toEqual({});
  });
});
