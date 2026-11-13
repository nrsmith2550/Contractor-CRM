import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ARTICLES } from "@/help";
import { activateLicense } from "@/server/auth/activation";
import { buildCtx } from "@/server/domain/context";
import { createLead } from "@/server/domain/leads";
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
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

async function newBusiness() {
  const id = randomBytes(4).toString("hex");
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Help Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "UTC",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { email, tenantId: res.tenantId, ownerId: res.userId };
}

test.describe("help guide", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("search, read, follow links, and every guide opens", async ({ page }) => {
    test.setTimeout(180_000);
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email } = await newBusiness();
    await signIn(page, email);

    // From the top bar to the help home.
    await page.getByRole("link", { name: "Help", exact: true }).first().click();
    await expect(page).toHaveURL(/\/app\/help$/);
    await expect(page.getByRole("heading", { name: "Help guide", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Start here" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Fixing problems" })).toBeVisible();

    // Search in plain words.
    await page.getByLabel("Search the help guide").fill("send a quote");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/q=send\+a\+quote|q=send%20a%20quote/);
    await expect(page.getByRole("region", { name: "Search results" })).toContainText(
      "Making and sending a quote",
    );
    await page.getByRole("link", { name: "Making and sending a quote" }).first().click();
    await expect(
      page.getByRole("heading", { name: "Making and sending a quote", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("The life of a quote")).toBeVisible();
    await expect(page.getByRole("link", { name: /Activate quote|Download PDF/ })).toHaveCount(0); // it's help text, not buttons

    // A related guide, then back to the home through the breadcrumb.
    await page.getByRole("region", { name: "Related guides" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/app\/help\/[a-z-]+$/);
    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Help guide" })
      .click();
    await expect(page).toHaveURL(/\/app\/help$/);

    // No match says so, and offers a way out.
    await page.getByLabel("Search the help guide").fill("zzzzqqqq");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByText("Nothing matched")).toBeVisible();

    // Every single guide opens with its own title.
    for (const a of ARTICLES) {
      await page.goto(`/app/help/${a.slug}`);
      await expect(
        page.getByRole("heading", { name: a.title, level: 1, exact: true }),
        a.slug,
      ).toBeVisible();
    }
    // An unknown guide is a clean "not found", not a crash.
    const res = await page.goto("/app/help/not-a-real-guide");
    expect(res?.status()).toBe(404);
  });

  test("lists link to their guide, and closing a prospect takes a chosen reason", async ({
    page,
  }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, tenantId, ownerId } = await newBusiness();
    const c = await buildCtx(tenantId, ownerId);
    const made = await createLead(c, {
      lastName: "Rivers",
      companyName: "Acme Roofing",
      email: "r@acme.test",
      phone: "412-555-0100",
    });
    if (!made.ok) throw new Error("lead");
    await signIn(page, email);

    await page.goto("/app/prospects?view=all_open");
    await page.getByRole("link", { name: "Help with prospects" }).click();
    await expect(
      page.getByRole("heading", { name: "Working with prospects", level: 1 }),
    ).toBeVisible();

    // Close it: the reason is a list to choose from, and it ends up Closed.
    await page.goto(`/app/prospects/${made.lead.id}`);
    await expect(page.getByRole("button", { name: "Reactivate" })).toHaveCount(0); // only for a closed prospect
    await page.getByRole("button", { name: "Close prospect" }).click();
    const panel = page.getByRole("group", { name: "Close prospect" });
    await panel.getByLabel("Reason").selectOption({ label: "Could not reach them" });
    await panel.getByRole("button", { name: "Confirm close" }).click();
    await expect(page.getByText("Prospect closed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reactivate" })).toBeVisible();
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.getByText("Prospect reactivated.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn into a customer" })).toBeVisible();
  });
});
