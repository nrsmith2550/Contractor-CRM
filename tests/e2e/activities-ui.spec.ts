import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";

test.describe("calls and tasks", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("log a call, add a task, and mark the task done from a prospect's timeline", async ({
    page,
  }) => {
    await page
      .context()
      .setExtraHTTPHeaders({ "x-real-ip": `10.8.${Math.floor(Math.random() * 250)}.5` });
    const id = randomBytes(4).toString("hex");
    const { key } = await mintLicense({ tier: "team" });
    const email = `act-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Calls Co ${id}`,
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

    await page.goto("/app/prospects/new");
    // Optional fields start tucked away under "More details".
    await expect(page.getByLabel("Est. value")).toBeHidden();
    await page.getByText("More details", { exact: true }).click();
    await expect(page.getByLabel("Est. value")).toBeVisible();
    await page.getByLabel("Last name").fill(`Calla${id}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/prospects\/[0-9a-f-]{36}$/);

    const what = page.getByRole("group", { name: "What to add" });

    // Log a call.
    await what.getByRole("button", { name: "Call" }).click();
    await page.getByLabel("What was the call about?").fill("Asked about a roof quote");
    await page.getByLabel("Direction").selectOption("incoming");
    await page.getByRole("button", { name: "Log call" }).click();
    const timeline = page.getByRole("list", { name: "Timeline" });
    await expect(timeline.getByText("Asked about a roof quote")).toBeVisible();
    await expect(timeline.getByText(/they called/)).toBeVisible();

    // Add a task with a due date in the past, so it shows as overdue.
    await what.getByRole("button", { name: "Task" }).click();
    await page.getByLabel("What needs doing?").fill("Send the brochure");
    await page.getByLabel("Due date").fill("2020-01-15");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(timeline.getByText("Send the brochure")).toBeVisible();
    await expect(timeline.getByText("Overdue")).toBeVisible();

    // Mark it done: the overdue flag goes and it reads as done.
    await page.getByRole("button", { name: "Mark done: Send the brochure" }).click();
    await expect(timeline.getByText("Overdue")).toHaveCount(0);
    await expect(timeline.getByText("completed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark done: Send the brochure" })).toHaveCount(0);
  });
});
