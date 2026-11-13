import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function newBusiness() {
  const id = rand();
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Calendar Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "America/New_York",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { email, tenantId: res.tenantId, ownerId: res.userId };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT = "rgb(245, 246, 250)";
const DARK = "rgb(11, 18, 32)";

test.describe("themes", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("follows the device, can be set to dark or light, and is remembered", async ({
    page,
    browser,
  }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email } = await newBusiness();

    // Before choosing anything it follows the device (light here).
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    expect(await bg(page)).toBe(LIGHT);

    // A device set to dark gets dark with no choice made, including on the sign-in page.
    const darkDevice = await browser.newContext({ colorScheme: "dark" });
    const p2 = await darkDevice.newPage();
    await p2.goto("/login");
    expect(await bg(p2)).toBe(DARK);
    await darkDevice.close();

    await signIn(page, email);
    expect(await page.getByRole("link", { name: "Clinch CRM home" }).count()).toBe(1);
    await expect(page).toHaveTitle(/Clinch CRM/);

    // Choose dark: applies immediately...
    await page.getByLabel("Theme").selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bg(page)).toBe(DARK);
    // ...and survives a reload, a trip to another page, and the sign-in page.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await bg(page)).toBe(DARK);
    await page.goto("/app/dashboards/sales");
    await expect(page.getByRole("heading", { name: "Sales dashboard" })).toBeVisible();
    expect(await bg(page)).toBe(DARK);
    // Text stays readable: the page text is light on the dark background.
    const color = await page.evaluate(() => getComputedStyle(document.body).color);
    expect(color).toBe("rgb(230, 234, 244)");

    // Back to light, even on a dark device.
    await page.getByLabel("Theme").selectOption("light");
    expect(await bg(page)).toBe(LIGHT);
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bg(page)).toBe(LIGHT);
    await page.reload();
    expect(await bg(page)).toBe(LIGHT);
  });
});
