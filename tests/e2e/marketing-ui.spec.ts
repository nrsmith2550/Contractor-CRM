import { expect, test } from "@playwright/test";

test.describe("marketing page", () => {
  test("says what Gantry is, shows the plans and prices, and each plan leads to the buy page", async ({
    page,
  }) => {
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
    await expect(plan("Gantry Complete")).toContainText("$70");
    await expect(plan("Gantry Complete")).toContainText("$500 setup fee");
    await expect(plan("Gantry Complete")).toContainText("Best value");
    await expect(plan("Gantry Deals")).toContainText("$45");
    await expect(plan("Gantry Deals")).toContainText("$300 setup fee");
    await expect(plan("Gantry Jobs")).toContainText("$45");
    await expect(plan("Gantry Jobs")).toContainText("$300 setup fee");
    await expect(plan("Gantry Complete")).toContainText("Saves $100 on setup and $20 a month");

    // What the first year costs, worked out for each option.
    const firstYear = pricing.getByRole("table", { name: "First-year cost of each option" });
    await expect(firstYear.getByRole("row", { name: /Gantry Complete/ })).toContainText("$1,340");
    await expect(firstYear.getByRole("row", { name: /Gantry Deals/ })).toContainText("$840");
    await expect(firstYear.getByRole("row", { name: /Gantry Jobs/ })).toContainText("$840");
    await expect(firstYear.getByRole("row", { name: /bought separately/ })).toContainText("$1,680");

    // More than 10 people: the price of each extra person, and a worked table.
    await expect(pricing.getByRole("heading", { name: "More than 10 people?" })).toBeVisible();
    await expect(pricing).toContainText("$5 a month each");
    await expect(pricing).toContainText("$3 a month each");
    const bySize = pricing.getByRole("table", { name: "Monthly price by number of people" });
    await expect(bySize.getByRole("row", { name: /^Up to 10/ })).toContainText("$70");
    await expect(bySize.getByRole("row", { name: /^25/ })).toContainText("$145");
    await expect(bySize.getByRole("row", { name: /^25/ })).toContainText("$90");
    await expect(bySize.getByRole("row", { name: /^50/ })).toContainText("$270");
    await expect(bySize.getByRole("row", { name: /^50/ })).toContainText("$165");

    // Each plan's button opens the buy page for that plan. Nothing is charged from this page.
    await expect(page.getByRole("button", { name: /buy|checkout|pay/i })).toHaveCount(0);
    for (const [name, id] of [
      ["Gantry Complete", "complete"],
      ["Gantry Deals", "deals"],
      ["Gantry Jobs", "jobs"],
    ] as const) {
      await expect(plan(name).getByRole("link", { name: `Get ${name}` })).toHaveAttribute(
        "href",
        `/buy?plan=${id}`,
      );
    }

    // Questions open and close.
    const q = page.getByText("How many people can use it?");
    await q.click();
    await expect(
      page.getByText(/Every plan includes up to 10 people signing in\. Add more for \$5/),
    ).toBeVisible();

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
      .addCookies([{ name: "gantry-theme", value: "dark", url: "http://localhost:3000" }]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
