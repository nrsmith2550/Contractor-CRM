import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { Edition } from "@/lib/plans";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";

async function signedIn(page: Page, edition: Edition) {
  await page.context().setExtraHTTPHeaders({
    "x-real-ip": `10.5.${Math.floor(Math.random() * 250)}.${edition.length}`,
  });
  const id = randomBytes(4).toString("hex");
  const { key } = await mintLicense({ edition });
  const email = `plan-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Plan Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

const menu = (page: Page) => page.getByRole("navigation", { name: "Site map" });

test.describe("plans", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("Gantry Deals shows only the Deals side, and the Jobs pages explain why they are closed", async ({
    page,
  }) => {
    await signedIn(page, "deals");
    for (const shown of [
      "Prospects",
      "Deals",
      "Quotes",
      "Orders",
      "Pipeline",
      "Customers",
      "People",
    ])
      await expect(menu(page).getByRole("link", { name: shown, exact: true })).toBeVisible();
    for (const hidden of ["Support requests", "Jobs", "Schedule", "Team members", "My visits"])
      await expect(menu(page).getByRole("link", { name: hidden, exact: true })).toHaveCount(0);

    // Home only shows the Deals side.
    await expect(page.getByRole("link", { name: /New prospect/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /New request/ })).toHaveCount(0);
    await expect(page.locator('a.crm-tile[href="/app/jobs"]')).toHaveCount(0);

    // Typing a Jobs address goes to a plain explanation, not an error.
    await page.goto("/app/jobs");
    await expect(page).toHaveURL(/\/app\/plan\?needs=jobs$/);
    await expect(page.getByRole("heading", { name: "Your plan", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Jobs isn't part of your plan");
    await expect(page.getByText("You're on Gantry Deals")).toBeVisible();
    await page.goto("/app/support-requests/new");
    await expect(page).toHaveURL(/\/app\/plan\?needs=jobs$/);
    await page.goto("/app/schedule");
    await expect(page).toHaveURL(/\/app\/plan\?needs=jobs$/);
    await page.goto("/app/dashboards/jobs");
    await expect(page).toHaveURL(/\/app\/plan\?needs=jobs$/);

    // The Deals side is open.
    await page.goto("/app/prospects");
    await expect(page.getByRole("heading", { name: "Prospects" })).toBeVisible();
    await page.goto("/app/quotes");
    await expect(page.getByRole("heading", { name: "Quotes" })).toBeVisible();
  });

  test("Gantry Jobs shows only the Jobs side, and the Deals pages explain why they are closed", async ({
    page,
  }) => {
    await signedIn(page, "jobs");
    for (const shown of ["Support requests", "Jobs", "Schedule", "Team members", "Customers"])
      await expect(menu(page).getByRole("link", { name: shown, exact: true })).toBeVisible();
    for (const hidden of ["Prospects", "Deals", "Quotes", "Orders", "Pipeline"])
      await expect(menu(page).getByRole("link", { name: hidden, exact: true })).toHaveCount(0);

    await expect(page.getByRole("link", { name: /New request/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /New prospect/ })).toHaveCount(0);
    await expect(page.getByPlaceholder("Search customers, people, jobs…")).toBeVisible();

    for (const url of ["/app/prospects", "/app/deals/new", "/app/quotes", "/app/pipeline"]) {
      await page.goto(url);
      await expect(page).toHaveURL(/\/app\/plan\?needs=deals$/);
    }
    await expect(page.getByRole("status")).toContainText("Deals isn't part of your plan");
    await expect(page.getByText("You're on Gantry Jobs")).toBeVisible();

    await page.goto("/app/jobs");
    await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
  });

  test("Gantry Complete shows everything, and Your plan says so", async ({ page }) => {
    await signedIn(page, "complete");
    for (const shown of ["Prospects", "Quotes", "Support requests", "Jobs", "Schedule"])
      await expect(menu(page).getByRole("link", { name: shown, exact: true })).toBeVisible();
    await menu(page).getByRole("link", { name: "Your plan" }).click();
    await expect(page.getByText("You're on Gantry Complete")).toBeVisible();
    await expect(page.getByText("Not in your plan")).toHaveCount(0);
  });
});
