import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { withTenant } from "@/db/client";
import { incident, workOrder } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

test.describe("service UI", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("case with SLA, convert to work order, work it, resolve and reactivate", async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const id = rand();
    const { key } = await mintLicense({ tier: "team" });
    const email = `owner-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Service Co ${id}`,
      ownerName: "Jordan Rivers",
      ownerEmail: email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      timeZone: "America/New_York",
      currency: "USD",
      ip: `ip-${id}`,
    });
    if (!res.ok) throw new Error(`activation failed: ${res.code}`);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();

    // The site map has the service links.
    await page
      .getByRole("navigation", { name: "Site map" })
      .getByRole("link", { name: "Support requests" })
      .click();
    await expect(page.getByRole("heading", { name: "Support requests" })).toBeVisible();

    // Administrators set up a subject and a queue.
    await page.goto("/app/settings/service");
    await page.getByLabel("Subject name").fill("Heating");
    await page.getByRole("button", { name: "Add subject" }).click();
    await expect(page.getByRole("list", { name: "Subjects" })).toContainText("Heating");
    await page.getByLabel("Queue name").fill("Dispatch");
    await page.getByRole("button", { name: "Add queue" }).click();
    await expect(page.getByRole("list", { name: "Queues" })).toContainText("Dispatch");

    // A new urgent case: its SLA counts down.
    await page.goto("/app/support-requests/new");
    await page.getByLabel("Title").fill("Furnace won't start");
    await page.getByLabel("Priority").selectOption("urgent");
    await page.getByLabel("Subject").selectOption({ label: "Heating" });
    await page.getByLabel("Queue").selectOption({ label: "Dispatch" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/support-requests\/[0-9a-f-]{36}$/);
    const caseUrl = page.url();
    const caseId = caseUrl.split("/").pop()!;
    await expect(page.getByText("REQ-01001").first()).toBeVisible();
    await expect(page.locator('[data-sla="on_track"]')).toContainText("left");

    // Push its due time into the past: it shows as breached, in the list too.
    await withTenant(res.tenantId, (tx) =>
      tx
        .update(incident)
        .set({ slaDueAt: new Date(Date.now() - 2 * 3_600_000) })
        .where(eq(incident.id, caseId)),
    );
    await page.reload();
    await expect(page.locator('[data-sla="breached"]')).toContainText("Breached");
    await expect(page.locator('[data-sla="breached"]')).toContainText("overdue");
    await page.goto("/app/support-requests");
    await expect(
      page.getByRole("row", { name: /REQ-01001/ }).locator('[data-sla="breached"]'),
    ).toBeVisible();

    // Convert to a work order: linked, Unscheduled.
    await page.goto(caseUrl);
    await page.getByRole("button", { name: "Turn into a job" }).click();
    await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
    await expect(page.getByText("JOB-01001").first()).toBeVisible();
    await expect(page.getByText("Unscheduled").first()).toBeVisible();
    const woUrl = page.url();
    const woId = woUrl.split("/").pop()!;
    await expect(page.getByRole("link", { name: "open the support request" })).toBeVisible();

    // The time window is entered in the business's zone (New York) and stored in UTC.
    await page.getByLabel("Time window start").fill("2030-07-15T09:00");
    await page.getByLabel("Time window end").fill("2030-07-15T12:00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
    const [stored] = await withTenant(res.tenantId, (tx) =>
      tx.select().from(workOrder).where(eq(workOrder.id, woId)),
    );
    expect(stored!.timeWindowStart!.toISOString()).toBe("2030-07-15T13:00:00.000Z"); // 09:00 EDT
    expect(stored!.timeWindowEnd!.toISOString()).toBe("2030-07-15T16:00:00.000Z");
    await page.reload();
    await expect(page.getByLabel("Time window start")).toHaveValue("2030-07-15T09:00");

    // An end before the start is refused.
    await page.getByLabel("Time window end").fill("2030-07-15T08:00");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".crm-error")).toContainText("end after it starts");

    // The case can't be resolved while the work order is open.
    await page.goto(caseUrl);
    await expect(page.getByRole("list").filter({ hasText: "JOB-01001" })).toBeVisible();
    await page.getByRole("button", { name: "Resolve request" }).click();
    await page.getByLabel("Resolution").fill("Replaced the igniter");
    await page.getByRole("button", { name: "Confirm resolve" }).click();
    await expect(page.locator(".crm-error")).toContainText("JOB-01001");

    // Work the order through its status flow.
    await page.goto(woUrl);
    for (const [button, status] of [
      ["Mark scheduled", "Scheduled"],
      ["Start work", "In progress"],
      ["Complete", "Completed"],
    ] as const) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page.getByText(status, { exact: true }).first()).toBeVisible();
    }

    // Now the case resolves; having breached its SLA it is recorded as missed.
    await page.goto(caseUrl);
    await page.getByRole("button", { name: "Resolve request" }).click();
    await page.getByLabel("Resolution").fill("Replaced the igniter");
    await page.getByLabel("Billable minutes").fill("75");
    await page.getByRole("button", { name: "Confirm resolve" }).click();
    await expect(page.getByText("Request resolved.")).toBeVisible();
    await expect(page.locator('[data-sla="missed"]')).toBeVisible();

    // Reactivating restarts the clock.
    await page.getByRole("button", { name: "Reactivate" }).click();
    await expect(page.locator('[data-sla="on_track"]')).toContainText("left");
  });
});
