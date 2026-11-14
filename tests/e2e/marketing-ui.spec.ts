import { expect, test } from "@playwright/test";

test.describe("marketing page", () => {
  test("says what Clinch is, shows the plans and prices, and has no checkout", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "Win the work. Run the work." }),
    ).toBeVisible();

    // The parts of the page: goals, benefits, functionality, journey, pricing, questions.
    for (const h of [
      "Built for the person running the business",
      "Why small businesses choose it",
      "What it does",
      "From first enquiry to finished work",
      "Simple pricing",
      "Questions",
    ])
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();

    // The three plans, with the agreed prices.
    const pricing = page.getByRole("region", { name: "Simple pricing" });
    const plan = (name: string) => pricing.getByRole("article", { name });
    await expect(plan("Clinch Complete")).toContainText("$70");
    await expect(plan("Clinch Complete")).toContainText("$500 setup fee");
    await expect(plan("Clinch Complete")).toContainText("Best value");
    await expect(plan("Clinch Deals")).toContainText("$45");
    await expect(plan("Clinch Deals")).toContainText("$300 setup fee");
    await expect(plan("Clinch Jobs")).toContainText("$45");
    await expect(plan("Clinch Jobs")).toContainText("$300 setup fee");
    await expect(plan("Clinch Complete")).toContainText("Saves $100 on setup and $20 a month");

    // What the first year costs, worked out for each option.
    const firstYear = pricing.getByRole("table", { name: "First-year cost of each option" });
    await expect(firstYear.getByRole("row", { name: /Clinch Complete/ })).toContainText("$1,340");
    await expect(firstYear.getByRole("row", { name: /Clinch Deals/ })).toContainText("$840");
    await expect(firstYear.getByRole("row", { name: /Clinch Jobs/ })).toContainText("$840");
    await expect(firstYear.getByRole("row", { name: /bought separately/ })).toContainText("$1,680");

    // No payment is taken here: the buttons get in touch, nothing buys.
    await expect(page.getByRole("button", { name: /buy|checkout|pay/i })).toHaveCount(0);
    for (const name of ["Clinch Complete", "Clinch Deals", "Clinch Jobs"]) {
      await expect(plan(name).getByRole("link", { name: `Get ${name}` })).toHaveAttribute(
        "href",
        /^(#contact|mailto:)/,
      );
    }

    // Questions open and close.
    const q = page.getByText("How many people can use it?");
    await q.click();
    await expect(page.getByText("Every plan includes up to 10 people signing in.")).toBeVisible();

    // Ways in.
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toHaveAttribute(
      "href",
      "/login",
    );
    await expect(page.getByRole("link", { name: "I have a licence key" })).toHaveAttribute(
      "href",
      "/activate",
    );
  });

  test("the old pricing address goes to the pricing section", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveURL(/\/#pricing$/);
    await expect(page.getByRole("heading", { name: "Simple pricing" })).toBeVisible();
  });

  test("fits a phone, and works in dark mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page
      .context()
      .addCookies([{ name: "clinch-theme", value: "dark", url: "http://localhost:3000" }]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
