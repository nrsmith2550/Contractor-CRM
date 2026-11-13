import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sales Hub" })).toBeVisible();
}

test.describe("plain names", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("the menu uses the plain names, and the old web addresses still work", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const id = randomBytes(4).toString("hex");
    const { key } = await mintLicense({ tier: "team" });
    const email = `owner-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Names Co ${id}`,
      ownerName: "Jordan Rivers",
      ownerEmail: email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      timeZone: "UTC",
      currency: "USD",
      ip: `ip-${id}`,
    });
    if (!res.ok) throw new Error(`activation failed: ${res.code}`);
    await signIn(page, email);

    const menu = page.getByRole("navigation", { name: "Site map" });
    const names = (await menu.getByRole("link").allTextContents()).map((t) => t.trim());
    for (const expected of [
      "Prospects",
      "Deals",
      "Support requests",
      "Jobs",
      "Schedule",
      "Team members",
      "My visits",
      "Customers",
      "People",
      "Products and services",
      "Pricing",
    ]) {
      expect(names, `menu has "${expected}"`).toContain(expected);
    }
    for (const gone of [
      "Leads",
      "Opportunities",
      "Cases",
      "Work orders",
      "Schedule board",
      "Resources",
      "My bookings",
      "Accounts",
      "Contacts",
      "Price lists",
    ]) {
      expect(names, `menu no longer has "${gone}"`).not.toContain(gone);
    }

    // Old addresses and bookmarks land on the new screens, keeping any filters.
    const moved: [old: string, now: RegExp, heading: string][] = [
      ["/app/leads?view=all_open", /\/app\/prospects\?view=all_open$/, "Prospects"],
      ["/app/accounts", /\/app\/customers$/, "Customers"],
      ["/app/contacts", /\/app\/people$/, "People"],
      ["/app/opportunities", /\/app\/deals$/, "Deals"],
      ["/app/cases", /\/app\/support-requests$/, "Support requests"],
      ["/app/work-orders", /\/app\/jobs$/, "Jobs"],
      ["/app/resources", /\/app\/team$/, "Team members"],
      ["/app/my-bookings", /\/app\/my-visits$/, "My visits"],
      ["/app/price-lists", /\/app\/pricing$/, "Pricing"],
    ];
    for (const [old, now, heading] of moved) {
      await page.goto(old);
      await expect(page, `${old} redirects`).toHaveURL(now);
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }
  });
});
