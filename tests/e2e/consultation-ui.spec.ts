import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Book a consultation", () => {
  test("the home page points to it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Book a free consultation" })).toHaveAttribute(
      "href",
      "/consultation",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Footer" })
        .getByRole("link", { name: "Book a consultation" }),
    ).toHaveAttribute("href", "/consultation");
  });

  test("it explains the call and asks for what we need", async ({ page }) => {
    await page.goto("/consultation");
    await expect(
      page.getByRole("heading", { level: 1, name: "Book a consultation" }),
    ).toBeVisible();
    const main = page.getByRole("main");
    await expect(main).toContainText("30-minute");
    await expect(main).toContainText("weekday evenings and Saturdays");
    for (const label of [
      "Your name",
      "Business name",
      "Email",
      "Phone number",
      "Your trade",
      "Team size",
      "Best time to call",
      "Your time zone",
    ]) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
    // The bot trap is not reachable by people or screen readers.
    await expect(page.locator(".mk-trap")).toHaveAttribute("aria-hidden", "true");
  });

  test("mistakes are shown next to the fields and nothing is sent", async ({ page }) => {
    await page.goto("/consultation");
    await page.getByLabel("Your name").fill("P");
    await page.getByLabel("Phone number").fill("555");
    await page.getByRole("button", { name: "Request a consultation" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "fix the highlighted" })).toBeFocused();
    await expect(page.getByText("Enter your name")).toBeVisible();
    await expect(page.getByText("Enter a phone number we can call")).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("heading", { name: /we got your request/ })).toHaveCount(0);
  });

  test("a complete request is accepted and says what happens next", async ({ page }) => {
    await page.goto("/consultation");
    const stamp = Date.now();
    await page.getByLabel("Your name").fill("Pat Jones");
    await page.getByLabel("Business name").fill("Jones Heating");
    await page.getByLabel("Email").fill(`pat-${stamp}@example.test`);
    await page.getByLabel("Phone number").fill("(412) 555-0100");
    await page.getByLabel("Your trade").selectOption("hvac");
    await page.getByLabel("Team size").selectOption("2-5");
    await page.getByLabel("Best time to call").selectOption("saturdays");
    await page.getByLabel("Anything you want us to know? (optional)").fill("Switching from paper.");
    await page.getByRole("button", { name: "Request a consultation" }).click();
    const thanks = page.getByRole("heading", { name: "Thank you, we got your request" });
    await expect(thanks).toBeVisible();
    await expect(thanks).toBeFocused();
    await expect(page.getByRole("main")).toContainText(`pat-${stamp}@example.test`);
  });

  test("it has no accessibility violations and fits a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/consultation");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
