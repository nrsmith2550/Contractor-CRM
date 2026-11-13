import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";

test.describe("home", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("greets the person, shows the counts, quick actions and the getting-started steps", async ({
    page,
  }) => {
    await page
      .context()
      .setExtraHTTPHeaders({ "x-real-ip": `10.7.${Math.floor(Math.random() * 250)}.9` });
    const id = randomBytes(4).toString("hex");
    const { key } = await mintLicense({ tier: "team" });
    const email = `home-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Home Co ${id}`,
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

    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.getByText("Welcome back, Jordan.")).toBeVisible();

    // Counts for each area, each one a link to its list.
    for (const [label, href] of [
      ["Open prospects", "/app/prospects?view=all_open"],
      ["Open deals", "/app/deals?view=open"],
      ["Active support requests", "/app/support-requests"],
      ["Open jobs", "/app/jobs"],
    ] as const) {
      await expect(page.locator(`a.crm-tile[href="${href}"]`)).toContainText(label);
    }

    // A new business is shown what to do first.
    const steps = page.getByRole("region", { name: "Getting started" });
    await expect(steps.getByRole("link", { name: "Add your first customer" })).toBeVisible();
    await expect(
      steps.getByRole("link", { name: "Add a product or service you sell" }),
    ).toBeVisible();

    // Quick actions go straight to the forms.
    await page
      .getByRole("group", { name: "Quick actions" })
      .getByRole("link", { name: /New prospect/ })
      .click();
    await expect(page).toHaveURL(/\/app\/prospects\/new$/);

    // The empty list invites the first record.
    await page.goto("/app/prospects");
    await expect(page.getByText("No prospects to show in this view.")).toBeVisible();
    await expect(page.getByRole("link", { name: "add prospect" })).toBeVisible();
  });
});
