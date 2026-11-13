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

test.describe("sales UI", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("create a lead, qualify it, and work the opportunity", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const id = rand();
    const { key } = await mintLicense({ tier: "team" });
    const email = `owner-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `UI Co ${id}`,
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

    // New lead through the metadata-driven form.
    await page.goto("/app/prospects/new");
    await page.getByLabel("Last name").fill(`Rivera${id}`);
    await page.getByLabel("Company").fill(`Acme ${id}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/prospects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: new RegExp(`Rivera${id}`) })).toBeVisible();

    // Notes appear on the timeline.
    await page.getByLabel("Add a note").fill("Called, wants a quote");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page.getByText("Called, wants a quote")).toBeVisible();

    // Qualify creates the account, contact and opportunity and lands on the opportunity.
    await page.getByRole("button", { name: "Turn into a customer", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/deals\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("list", { name: "Progress bar" })).toBeVisible();

    // Closing as won needs the actual revenue.
    await page.getByRole("button", { name: "Close as won" }).click();
    await page.getByLabel("Actual revenue").fill("12,500.00");
    await page.getByRole("button", { name: "Confirm won" }).click();
    await expect(page.getByRole("status")).toContainText("Won");

    // The grid lists the new account as a customer.
    await page.goto("/app/customers?view=customers");
    await expect(page.getByRole("link", { name: `Acme ${id}` })).toBeVisible();
  });
});
