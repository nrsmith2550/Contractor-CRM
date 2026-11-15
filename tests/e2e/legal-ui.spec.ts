import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Terms and Privacy", () => {
  test("the Terms state the seller, the refund promise, the law and a way to get in touch", async ({
    page,
  }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("Nathan Smith, doing business as Gantry CRM");
    await expect(main).toContainText("14-day money-back guarantee");
    await expect(main).toContainText("laws of Pennsylvania");
    await expect(main).toContainText("Allegheny County");
    await expect(main.getByRole("link", { name: "support@gantrycrm.com" }).first()).toHaveAttribute(
      "href",
      "mailto:support@gantrycrm.com",
    );

    // The contents list jumps to a section.
    await page
      .getByRole("navigation", { name: "Contents" })
      .getByRole("link", { name: "Governing law" })
      .click();
    await expect(page).toHaveURL(/#law$/);
    await expect(page.getByRole("heading", { name: /Governing law/ })).toBeVisible();
  });

  test("the Privacy Policy names who handles data and what is never done with it", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
    const main = page.getByRole("main");
    for (const name of ["Stripe", "Vercel", "Neon", "Resend", "ImprovMX"]) {
      await expect(main.getByText(name, { exact: false }).first()).toBeVisible();
    }
    await expect(main).toContainText("We do not sell personal information");
    await expect(main).toContainText("never see or store a full card number");
  });

  test("the home page footer and the checkout both link to them", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("navigation", { name: "Footer" });
    await expect(footer.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");

    await page.goto("/buy?plan=deals");
    const agree = page.getByText(/By paying you agree to our/);
    await expect(agree).toContainText("14-day money-back guarantee");
    await expect(agree.getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
      "href",
      "/terms",
    );
    await expect(agree.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  for (const path of ["/terms", "/privacy"]) {
    test(`${path} has no accessibility violations and fits a phone`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 800 });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflow).toBe(false);
    });
  }
});
