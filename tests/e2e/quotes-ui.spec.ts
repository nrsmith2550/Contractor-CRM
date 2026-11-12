import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

test.describe("quotes UI", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("catalog, quote builder, activate, revise, win and order", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const id = rand();
    const { key } = await mintLicense({ tier: "team" });
    const email = `owner-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Quote Co ${id}`,
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
    await expect(page.getByRole("heading", { name: "Sales Hub" })).toBeVisible();

    // A tax rate, then a product that uses it.
    await page.goto("/app/settings/tax-rates");
    await page.getByLabel("Name").fill("State tax");
    await page.getByLabel("Rate (%)").fill("7");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("State tax: 7.00%")).toBeVisible();

    const sku = `W-${id}`;
    await page.goto("/app/products/new");
    await page.getByLabel("SKU").fill(sku);
    await page.getByLabel("Name").fill("Widget");
    await page.getByLabel("List price").fill("19.99");
    await page.getByLabel("Tax rate").selectOption({ label: "State tax (7.00%)" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/products\/[0-9a-f-]{36}$/);

    // A quote with 3 widgets: 3 x 19.99 = 59.97, 7% tax = 4.20, total 64.17.
    await page.goto("/app/quotes/new");
    await page.getByLabel("Name").fill("Fence job");
    await page.getByRole("button", { name: "Create quote" }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]{36}$/);
    await page.getByLabel("Product").selectOption({ label: `Widget (${sku})` });
    await page.getByLabel("Quantity").fill("3");
    await page.getByRole("button", { name: "Add line" }).click();
    await expect(page.getByLabel("Totals")).toContainText("$64.17");
    await expect(page.getByRole("table", { name: "Quote lines" })).toContainText("Widget");

    // Active quotes are read-only.
    await page.getByRole("button", { name: "Activate quote" }).click();
    await expect(page.getByText("This quote is active")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);

    // Revise creates -R1 as a draft.
    await page.getByRole("button", { name: "Revise" }).click();
    await expect(page.getByRole("heading", { name: "Fence job" })).toBeVisible();
    await expect(page.getByText("Quote QUO-01001-R1")).toBeVisible();
    await page.getByRole("button", { name: "Activate quote" }).click();

    // Winning creates the order.
    await page.getByRole("button", { name: "Close as won" }).click();
    await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Order ORD-01001")).toBeVisible();
    await expect(page.getByRole("table", { name: "Order lines" })).toContainText("Widget");
  });
});
