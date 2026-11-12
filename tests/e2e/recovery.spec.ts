import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { withPlatform } from "@/db/client";
import { license } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const MAIL_DIR = ".dev-mail-e2e";
const PASSWORD = "violet-lantern-orbit-42";
const NEW_PASSWORD = "copper-meadow-lantern-77";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

/** The link in the newest dev email written for `to`, waiting for the server to write it. */
async function emailedLink(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const files = await readdir(MAIL_DIR).catch(() => [] as string[]);
    // Same sanitising as the mailer uses to name the file.
    const safe = to.replace(/[^a-z0-9@.]+/gi, "_");
    const mine = files.filter((f) => f.endsWith(`-${safe}.txt`)).sort();
    if (mine.length > 0) {
      const body = await readFile(`${MAIL_DIR}/${mine.at(-1)}`, "utf8");
      const m = /https?:\/\/\S+token=[A-Za-z0-9_%-]+/.exec(body);
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No email link for ${to}`);
}

async function newBusiness(seatLimit?: number) {
  const id = rand();
  const { key } = await mintLicense({ tier: "team", seatLimit });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Recovery Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { id, email, company: `Recovery Co ${id}`, tenantId: res.tenantId };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("password reset and invitations", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test.beforeEach(async ({ context }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
  });

  test("forgot password → emailed link → new password → sign in; the link works once", async ({
    page,
  }) => {
    const o = await newBusiness();

    await page.goto("/login");
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);

    // An unknown address gets the very same confirmation (no account enumeration).
    const same = /If an account exists for that address/;
    await page.getByRole("textbox", { name: "Email" }).fill(`nobody-${rand()}@example.test`);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText(same)).toBeVisible();

    await page.goto("/forgot-password");
    await page.getByRole("textbox", { name: "Email" }).fill(o.email);
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText(same)).toBeVisible();

    const link = await emailedLink(o.email);
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();

    // A weak password is refused and the link survives.
    await page.getByRole("textbox", { name: "New password", exact: true }).fill("password1234");
    await page.getByRole("textbox", { name: "Confirm new password" }).fill("password1234");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText("too common")).toBeVisible();

    await page.getByRole("textbox", { name: "New password", exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("textbox", { name: "Confirm new password" }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByText("Your password was changed")).toBeVisible();

    // The old password no longer works; the new one does.
    await signIn(page, o.email, PASSWORD);
    await expect(
      page.getByRole("alert").filter({ hasText: "Incorrect email or password." }),
    ).toBeVisible();
    await page.getByLabel("Password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    // Reusing the link shows a dead end.
    await page.goto(link);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  });

  test("owner invites a user, the invitee joins; the seat limit shows an upgrade prompt", async ({
    page,
    browser,
  }) => {
    const o = await newBusiness(2); // owner + one invited user
    await signIn(page, o.email, PASSWORD);
    await expect(page).toHaveURL(/\/app$/);
    await page.getByRole("link", { name: "Users" }).click();
    await expect(page.getByRole("heading", { name: "Users", exact: true })).toBeVisible();
    await expect(page.getByText("1 of 2")).toBeVisible();

    const invitee = `invitee-${o.id}@example.test`;
    await page.getByRole("textbox", { name: "Email to invite" }).fill(invitee);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation sent to ${invitee}.`)).toBeVisible();

    // The pending invitation holds the second seat, so a further invite is refused.
    await page.getByRole("textbox", { name: "Email to invite" }).fill(`more-${o.id}@example.test`);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Upgrade your license" })).toBeVisible();

    // The invitee opens the emailed link in their own browser and joins.
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": fakeIp() } });
    const guest = await ctx.newPage();
    await guest.goto(await emailedLink(invitee));
    await expect(guest.getByRole("heading", { name: `Join ${o.company}` })).toBeVisible();
    await guest.getByRole("textbox", { name: "Your full name" }).fill("Sam Invitee");
    await guest.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
    await guest.getByRole("textbox", { name: "Confirm password" }).fill(PASSWORD);
    await guest.getByRole("button", { name: "Join" }).click();
    await expect(guest).toHaveURL(/\/app$/);
    await expect(guest.getByText(o.company)).toBeVisible();

    // A Salesperson can't manage users.
    await guest.goto("/app/settings/users");
    await expect(guest.getByText("You don't have permission to view this page.")).toBeVisible();

    // The invitation link is single-use.
    await guest.context().clearCookies();
    await guest.goto(await emailedLink(invitee));
    await expect(guest.getByRole("heading", { name: "This invitation isn't valid" })).toBeVisible();
    await ctx.close();

    // The owner now sees two of two seats in use, and the count follows the license.
    await page.reload();
    await expect(page.getByText("2 of 2")).toBeVisible();
    await expect(page.getByText("Sam Invitee")).toBeVisible();
    await withPlatform((tx) =>
      tx.update(license).set({ seatLimit: 3 }).where(eq(license.tenantId, o.tenantId)),
    );
    await page.reload();
    await expect(page.getByText("2 of 3")).toBeVisible();
  });
});
