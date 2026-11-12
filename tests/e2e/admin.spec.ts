import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { withPlatform } from "@/db/client";
import { createPlatformAdmin } from "@/server/admin/bootstrap";
import { currentStep, totpCode } from "@/server/admin/totp";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const ADMIN_PASSWORD = "granite-harbor-compass-88";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function newAdmin() {
  const email = `admin-${rand()}@platform.test`;
  const a = await withPlatform((tx) =>
    createPlatformAdmin(tx, { email, password: ADMIN_PASSWORD }),
  );
  return { email, secret: a.secret };
}

async function newBusiness() {
  const id = rand();
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Console Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { id, email, company: `Console Co ${id}`, tenantId: res.tenantId };
}

async function passwordStep(page: Page, email: string, password = ADMIN_PASSWORD) {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function codeStep(page: Page, secret: Buffer, offset = 0) {
  await page.getByLabel("6-digit code").fill(totpCode(secret, currentStep() + offset));
  await page.getByRole("button", { name: "Verify" }).click();
}

/** Full two-step sign-in; waits until the console has actually loaded before returning. */
async function signInAdmin(page: Page, admin: { email: string; secret: Buffer }) {
  await passwordStep(page, admin.email);
  await expect(page).toHaveURL(/\/admin\/verify$/);
  await codeStep(page, admin.secret);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
}

/** The form on the page that contains this submit button (the console has many similar forms). */
const formWith = (page: Page, button: string) =>
  page.locator("form", { has: page.getByRole("button", { name: button, exact: true }) });

async function tenantSignIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("platform admin console", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
  });

  test("password + authenticator code, a password alone never gets in, and codes can't be replayed", async ({
    page,
    browser,
  }) => {
    const admin = await newAdmin();

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);

    await passwordStep(page, admin.email, "not-the-right-password");
    await expect(
      page.getByRole("alert").filter({ hasText: "Incorrect email or password." }),
    ).toBeVisible();

    await passwordStep(page, admin.email);
    await expect(page).toHaveURL(/\/admin\/verify$/);

    // Password alone is not enough: the console bounces back to the code step.
    await page.goto("/admin/licenses");
    await expect(page).toHaveURL(/\/admin\/verify$/);

    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "isn't right" })).toBeVisible();

    await codeStep(page, admin.secret);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    // The code just used is burned: a second sign-in can't reuse it.
    const other = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": fakeIp() } });
    const second = await other.newPage();
    await passwordStep(second, admin.email);
    await expect(second).toHaveURL(/\/admin\/verify$/);
    await codeStep(second, admin.secret);
    await expect(second.getByRole("alert").filter({ hasText: "isn't right" })).toBeVisible();
    await expect(second).toHaveURL(/\/admin\/verify$/);
    await other.close();

    // Sign out ends the session.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin/tenants");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test("mint a license, recover an owner, suspend the license, and read the audit log", async ({
    page,
    browser,
  }) => {
    const admin = await newAdmin();
    const biz = await newBusiness();
    page.on("dialog", (d) => d.accept());

    await signInAdmin(page, admin);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    // Mint a license: a reason is mandatory, and the key is shown once.
    await page.getByRole("link", { name: "Licenses" }).click();
    const mint = formWith(page, "Mint license");
    // Retry the click until the page has hydrated: an early click would submit the form natively.
    await expect(async () => {
      await mint.getByRole("button", { name: "Mint license" }).click();
      await expect(
        page.getByRole("alert").filter({ hasText: "at least 5 characters" }),
      ).toBeVisible({ timeout: 1500 });
    }).toPass();
    await mint.getByRole("textbox", { name: /Reason/ }).fill("E2E demo license");
    await mint.getByRole("button", { name: "Mint license" }).click();
    await expect(page.getByTestId("one-time-secret")).toHaveText(
      /^CRM-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/,
    );

    // Find the business and open it.
    await page.getByRole("link", { name: "Businesses" }).click();
    await page.getByRole("link", { name: biz.company }).click();
    await expect(page.getByRole("heading", { name: biz.company })).toBeVisible();
    await expect(page.getByText(biz.email)).toBeVisible();

    // The owner is signed in, in their own browser.
    const ownerCtx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": fakeIp() } });
    const owner = await ownerCtx.newPage();
    await tenantSignIn(owner, biz.email, PASSWORD);
    await expect(owner).toHaveURL(/\/app$/);

    // A tenant session is not an admin session.
    await owner.goto("/admin");
    await expect(owner).toHaveURL(/\/admin\/login$/);
    await owner.goto("/app");
    await expect(owner).toHaveURL(/\/app$/);

    // Temporary password: shown once, signs the owner out, and forces a change at next sign-in.
    const temp = formWith(page, "Issue temporary password");
    await temp.getByRole("textbox", { name: /Reason/ }).fill("Owner lost email access");
    await temp.getByRole("button", { name: "Issue temporary password" }).click();
    const secret = page.getByTestId("one-time-secret");
    await expect(secret).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    const tempPassword = (await secret.textContent())!;

    await owner.reload();
    await expect(owner).toHaveURL(/\/login$/); // signed out by the admin action
    await tenantSignIn(owner, biz.email, PASSWORD);
    await expect(
      owner.getByRole("alert").filter({ hasText: "Incorrect email or password." }),
    ).toBeVisible();
    await owner.getByLabel("Password").fill(tempPassword);
    await owner.getByRole("button", { name: "Sign in" }).click();
    await expect(owner).toHaveURL(/\/change-password$/);
    await expect(owner.getByText("choose a new password before you continue")).toBeVisible();

    // Suspending the license locks the business out on its next request; reinstating restores it.
    const status = formWith(page, "Apply");
    await status.getByRole("textbox", { name: /Reason/ }).fill("Chargeback opened");
    await status.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("License is now suspended.")).toBeVisible();
    await owner.goto("/app");
    await expect(owner).toHaveURL(/\/login\?reason=license/);

    await status.getByRole("combobox", { name: "Action" }).selectOption("reinstate");
    await status.getByRole("textbox", { name: /Reason/ }).fill("Dispute won");
    await status.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("License is now active.")).toBeVisible();
    await ownerCtx.close();

    // Everything above is in the audit log, with the admin's email and the reason.
    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    for (const text of [
      "license.mint",
      "owner.temp_password",
      "license.suspend",
      "license.reinstate",
      "Owner lost email access",
      "Chargeback opened",
      admin.email,
    ]) {
      await expect(page.getByText(text).first()).toBeVisible();
    }
    // The temporary password itself is nowhere in the log.
    await expect(page.getByText(tempPassword)).toHaveCount(0);
  });

  test("re-activate: the business keeps its data and a new owner claims it on the activation page", async ({
    page,
    browser,
  }) => {
    const admin = await newAdmin();
    const { key } = await mintLicense({ tier: "team" });
    const id = rand();
    const ownerEmail = `owner-${id}@example.test`;
    const activated = await activateLicense({
      licenseKey: key,
      companyName: `Reclaim Co ${id}`,
      ownerName: "Former Owner",
      ownerEmail,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      timeZone: "UTC",
      currency: "USD",
      ip: `ip-${id}`,
    });
    if (!activated.ok) throw new Error("activation failed");
    page.on("dialog", (d) => d.accept());

    await signInAdmin(page, admin);
    await page.goto(`/admin/tenants/${activated.tenantId}`);
    const form = formWith(page, "Re-activate license");
    await form.getByRole("textbox", { name: /Reason/ }).fill("Owner left; new contact taking over");
    await form.getByRole("button", { name: "Re-activate license" }).click();
    await expect(page.getByText("returned to a claimable state")).toBeVisible();
    await page.reload();
    await expect(page.getByText("awaiting a new owner")).toBeVisible();

    // The new owner uses the normal activation page, with the same key and the original address.
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": fakeIp() } });
    const guest = await ctx.newPage();
    await guest.goto("/activate");
    await guest.getByLabel("License key").fill(key);
    await guest.getByLabel("Company name").fill("Ignored");
    await guest.getByLabel("Your full name").fill("New Owner");
    await guest.getByLabel("Your email").fill(ownerEmail);
    await guest
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("copper-meadow-lantern-77");
    await guest.getByRole("textbox", { name: "Confirm password" }).fill("copper-meadow-lantern-77");
    await guest.getByRole("button", { name: "Set up my business" }).click();
    await expect(guest).toHaveURL(/\/app$/);
    await expect(guest.getByText(`Reclaim Co ${id}`)).toBeVisible(); // original business name kept
    await ctx.close();
  });
});
