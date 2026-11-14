import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";

/** A signed-in owner. `subscribed` gives the licence a subscription, as if bought on the site. */
async function signedIn(page: Page, subscribed: boolean) {
  await page.context().setExtraHTTPHeaders({
    "x-real-ip": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  const id = randomBytes(4).toString("hex");
  const { key } = await mintLicense({
    edition: "complete",
    ...(subscribed
      ? {
          stripeCustomerId: `cus_e2e_${id}`,
          stripeSubscriptionId: `sub_e2e_${id}`,
          billingStatus: "active" as const,
        }
      : {}),
  });
  const email = `bill-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Billing Co ${id}`,
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

test.describe("billing page", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("a business that bought on the site has a Billing link and page; the payment provider being unreachable is a calm message", async ({
    page,
  }) => {
    await signedIn(page, true);
    await menu(page).getByRole("link", { name: "Billing", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings\/billing$/);
    await expect(page.getByRole("heading", { level: 1, name: /Billing/ })).toBeVisible();
    // The test keys are not real, so Stripe cannot be reached: a plain message, no error page.
    await expect(page.getByRole("status").filter({ hasText: "could not reach" })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByRole("link", { name: "See what is in your plan" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("a business set up by hand has no Billing link, and the page says why", async ({ page }) => {
    await signedIn(page, false);
    await expect(menu(page).getByRole("link", { name: "Billing", exact: true })).toHaveCount(0);
    await page.goto("/app/settings/billing");
    await expect(page.getByRole("status")).toContainText("not billed through the site");
  });
});
