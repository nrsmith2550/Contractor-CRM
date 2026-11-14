import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("buy page", () => {
  test("opens on the plan that was clicked and shows what it costs", async ({ page }) => {
    await page.goto("/");
    const pricing = page.getByRole("region", { name: "Simple pricing" });
    await pricing
      .getByRole("article", { name: "Gantry Deals" })
      .getByRole("link", { name: "Get Gantry Deals" })
      .click();
    await expect(page).toHaveURL(/\/buy\?plan=deals$/);
    await expect(page.getByRole("heading", { level: 1, name: "Buy Gantry CRM" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Gantry Deals/ })).toBeChecked();

    const order = page.getByRole("complementary", { name: "Your order" });
    await expect(order).toContainText("Gantry Deals");
    await expect(order).toContainText("$45 a month");
    await expect(order.getByText("One-time setup fee")).toBeVisible();
    await expect(order).toContainText("$300");
    await expect(order.locator("div", { hasText: /^Due today/ })).toContainText("$345");
    // The test-mode note is shown while a test key is in use, so nobody enters a real card.
    await expect(page.getByText("No real money moves")).toBeVisible();
  });

  test("the price follows the plan and the number of people", async ({ page }) => {
    await page.goto("/buy?plan=complete&people=25");
    const order = page.getByRole("complementary", { name: "Your order" });
    await expect(page.getByLabel(/How many people/)).toHaveValue("25");
    await expect(order).toContainText("15 extra people at $5");
    await expect(order).toContainText("$75 a month"); // 15 extra people
    await expect(order.locator("div", { hasText: /^Due today/ })).toContainText("$645"); // 500 + 145
    await expect(order.locator("div", { hasText: /^Then every month/ })).toContainText("$145");

    await page.getByRole("radio", { name: /Gantry Jobs/ }).check();
    await expect(order).toContainText("15 extra people at $3");
    await expect(order.locator("div", { hasText: /^Due today/ })).toContainText("$390"); // 300 + 90

    // Up to the 10 included people there is no extra line.
    await page.getByLabel(/How many people/).fill("10");
    await expect(order).not.toContainText("extra");
    await expect(order.locator("div", { hasText: /^Due today/ })).toContainText("$345");
  });

  test("refuses a team size it cannot sell, and asks for a quote instead", async ({ page }) => {
    await page.goto("/buy");
    const people = page.getByLabel(/How many people/);
    const next = page.getByRole("button", { name: /Continue to payment/ });
    await expect(next).toBeEnabled();

    await people.fill("80");
    await expect(page.getByRole("alert").filter({ hasText: "from 10 to 50" })).toBeVisible();
    await expect(next).toBeDisabled();

    await people.fill("1.5");
    await expect(next).toBeDisabled();

    // Leaving the field puts back a sensible number rather than leaving it broken.
    await people.fill("80");
    await people.blur();
    await expect(people).toHaveValue("50");
    await expect(next).toBeEnabled();
    await people.fill("");
    await people.blur();
    await expect(people).toHaveValue("10");
  });

  test("a payment that cannot be started says so and stays on the page", async ({ page }) => {
    await page.goto("/buy?plan=jobs");
    await page.getByRole("button", { name: /Continue to payment/ }).click();
    // The test keys are not real, so Stripe refuses: the buyer sees a plain message, nothing breaks
    // and nobody is sent anywhere else.
    await expect(
      page.getByRole("alert").filter({ hasText: "could not start the payment form" }),
    ).toBeVisible({
      timeout: 45_000,
    });
    await expect(page).toHaveURL(/\/buy\?plan=jobs$/);
    await expect(page.getByRole("radio", { name: /Gantry Jobs/ })).toBeChecked();
  });

  test("bad plan or people in the address fall back to safe defaults", async ({ page }) => {
    await page.goto("/buy?plan=platinum&people=9999");
    await expect(page.getByRole("radio", { name: /Gantry Complete/ })).toBeChecked();
    await expect(page.getByLabel(/How many people/)).toHaveValue("10");
  });

  test("has no accessibility violations and works on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/buy?plan=complete&people=20");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
