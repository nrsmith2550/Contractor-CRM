import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { license } from "@/db/schema";
import { generateLicenseKey } from "@/server/auth/license-key";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";

async function fillActivation(page: Page, key: string, company: string, email: string) {
  await page.goto("/activate");
  await page.getByLabel("License key").fill(key);
  await page.getByLabel("Company name").fill(company);
  await page.getByLabel("Your full name").fill("Jordan Rivers");
  await page.getByLabel("Your email").fill(email);
  // Role locators match the accessible name; getByLabel would see the "required" asterisk.
  await page.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await page.getByRole("textbox", { name: "Confirm password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Set up my business" }).click();
}

test.describe("activation and sign-in", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  // Locally there is no proxy, so every request would share one IP and trip the (working)
  // activation rate limit across tests and reruns. Give each test its own client IP.
  test.beforeEach(async ({ context }) => {
    const octet = () => 1 + Math.floor(Math.random() * 253);
    await context.setExtraHTTPHeaders({ "x-real-ip": `10.${octet()}.${octet()}.${octet()}` });
  });

  test("activate once, sign out, sign in, and a suspended license locks everyone out", async ({
    page,
  }) => {
    const id = randomBytes(4).toString("hex");
    const company = `E2E Plumbing ${id}`;
    const email = `owner-${id}@example.test`;
    const { key } = await mintLicense({ tier: "starter" });

    // Protected pages bounce to sign-in when signed out.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);

    // Activation creates the business and signs the owner in on the Home.
    await fillActivation(page, key, company, email);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.getByText(company)).toBeVisible();

    // The same key can't be activated twice: it redirects to sign-in with a masked email hint.
    await page.context().clearCookies();
    await fillActivation(page, key, `${company} again`, `second-${id}@example.test`);
    await expect(page).toHaveURL(/\/login\?hint=/);
    await expect(page.getByText("o***@example.test")).toBeVisible();

    // Wrong password is refused with a generic message; the right one signs in.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("not-the-right-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Next.js also renders a hidden route announcer with role=alert, so filter by text.
    await expect(
      page.getByRole("alert").filter({ hasText: "Incorrect email or password." }),
    ).toBeVisible();
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // Sign out ends the session.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login$/);

    // Suspending the license signs an active session out on its very next request.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await withPlatform((tx) =>
      tx
        .update(license)
        .set({ status: "suspended" })
        .where(eq(license.keyLast5, key.slice(-5))),
    );
    await page.reload();
    await expect(page).toHaveURL(/\/login\?reason=license/);
    await expect(page.getByRole("alert").filter({ hasText: "isn't active" })).toBeVisible();
  });

  test("a bad license key is flagged on the form", async ({ page }) => {
    // A fresh random key with a wrong last character: well-formed but bad checksum. (A fixed
    // fake key would share one per-key-prefix rate-limit counter across every run.)
    const real = generateLicenseKey();
    const bad = real.slice(0, -1) + (real.endsWith("0") ? "1" : "0");
    await fillActivation(
      page,
      bad,
      "Nope Co",
      `nope-${randomBytes(4).toString("hex")}@example.test`,
    );
    await expect(page.getByText("That license key isn't valid")).toBeVisible();
    await expect(page).toHaveURL(/\/activate$/);
  });
});
