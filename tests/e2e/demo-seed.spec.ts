import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedDemo } from "@/db/seed/demo";

const PASSWORD = "violet-lantern-orbit-42";
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

test.describe("demo business", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("the demo logins work, each role sees its own work, and the full pages are accessible", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const id = randomBytes(3).toString("hex");
    const demo = await seedDemo({
      ownerEmail: `owner@demo-${id}.example`,
      emailDomain: `demo-${id}.example`,
      password: PASSWORD,
    });
    const email = (name: string) => demo.people.find((p) => p.name === name)!.email;

    // The owner sees a populated business.
    await signIn(page, email("Jordan Rivers"));
    // Home counts everyone's open work, and a "My ..." list with nothing in it shows the wider list.
    await page.goto("/app");
    await expect(page.locator('a.crm-tile[href="/app/prospects?view=all_open"]')).toContainText(
      "12",
    );
    await expect(page.getByRole("region", { name: "Your open tasks" })).toBeVisible();
    await page.goto("/app/prospects");
    await expect(page.getByText("You don't have any prospects of your own yet")).toBeVisible();
    await expect(page.getByText("12 records")).toBeVisible();
    await page.goto("/app/prospects?view=all_open");
    await expect(page.getByText("12 records")).toBeVisible();
    await page.goto("/app/dashboards/sales");
    await expect(page.getByRole("region", { name: /^Won revenue/ })).not.toContainText("$0.00");
    await page.goto("/app/dashboards/service");
    await expect(page.getByRole("region", { name: "SLA breaches" })).toContainText(
      "SLA breaches (1)",
    );

    // A technician (own context, so their own session) sees only their own visits.
    const techCtx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": fakeIp() } });
    const tech = await techCtx.newPage();
    await signIn(tech, email("Riley Ortiz"));
    await tech.goto("/app/my-visits");
    await expect(tech.getByRole("heading", { name: /my visits/i })).toBeVisible();
    await expect(tech.getByText(/JOB-0\d+/).first()).toBeVisible();
    await tech.goto("/app/dashboards/sales");
    await expect(tech.getByText("You don't have access to this.").first()).toBeVisible();
    await techCtx.close();

    // Realistic, full pages stay free of accessibility violations in both themes.
    const pages = [
      "/app/prospects?view=all_open",
      "/app/customers?view=all",
      "/app/deals?view=open",
      "/app/pipeline",
      "/app/quotes",
      "/app/orders",
      "/app/support-requests?view=all_active",
      "/app/jobs",
      "/app/schedule?view=day",
      "/app/calendar",
      "/app/dashboards/sales",
      "/app/dashboards/service",
    ];
    const found: Record<string, unknown> = {};
    for (const theme of ["light", "dark"]) {
      await page
        .context()
        .addCookies([{ name: "clinch-theme", value: theme, url: "http://localhost:3000" }]);
      for (const p of pages) {
        await page.goto(p);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        if (r.violations.length) {
          found[`${theme} ${p}`] = r.violations.map((v) => ({
            rule: v.id,
            nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
          }));
        }
      }
    }
    expect(found).toEqual({});
  });
});
