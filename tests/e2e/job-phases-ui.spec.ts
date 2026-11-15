import AxeBuilder from "@axe-core/playwright";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { buildCtx } from "@/server/domain/context";
import { createResource } from "@/server/domain/resources";
import { createWorkOrder } from "@/server/domain/work-orders";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function newJob() {
  const id = rand();
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Field Co ${id}`,
    ownerName: "Jordan Rivers",
    ownerEmail: email,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    timeZone: "America/New_York",
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  const ctx = await buildCtx(res.tenantId, res.userId);
  const crew = await createResource(ctx, { name: "Crew A" });
  if (!crew.ok) throw new Error("resource not created");
  const made = await createWorkOrder(ctx, { title: "Replace the furnace" });
  if (!made.ok) throw new Error("job not created");
  return { email, jobId: made.workOrder.id };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

test.describe("job phases UI", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("a dispatcher splits a job into phases and works through them", async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, jobId } = await newJob();
    await signIn(page, email);
    await page.goto(`/app/work-orders/${jobId}`);

    const phases = page.getByRole("region", { name: "Phases" });
    await expect(phases).toContainText("This job has no phases");

    // Two phases, each its own piece of work.
    await phases.getByLabel("Phase title").fill("Remove the old furnace");
    await phases.getByLabel("Estimate (minutes)").fill("120");
    await phases.getByRole("button", { name: "Add phase" }).click();
    await expect(phases.getByRole("table", { name: "Phases of this job" })).toContainText(
      "Remove the old furnace",
    );
    await phases.getByLabel("Phase title").fill("Install the new furnace");
    await phases.getByRole("button", { name: "Add phase" }).click();
    const table = phases.getByRole("table", { name: "Phases of this job" });
    await expect(table.getByRole("row")).toHaveCount(3); // header + two phases
    await expect(phases).toContainText("0 of 2 phases done");

    // A blank title is refused with a message.
    await phases.getByRole("button", { name: "Add phase" }).click();
    await expect(phases.getByText("Enter a title for the phase")).toBeVisible();

    // Work phase 1 through to done.
    await phases.getByRole("button", { name: "Start phase 1" }).click();
    await expect(table.getByRole("row").nth(1)).toContainText("In progress");
    await phases.getByRole("button", { name: "Complete phase 1" }).click();
    await expect(phases).toContainText("1 of 2 phases done");

    await phases.getByRole("button", { name: "Cancel phase 2" }).click();
    await expect(phases).toContainText("1 of 1 phase done");
  });

  test("a dispatcher books a visit for one phase and it shows which phase", async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, jobId } = await newJob();
    await signIn(page, email);
    await page.goto(`/app/work-orders/${jobId}`);
    const phases = page.getByRole("region", { name: "Phases" });
    await phases.getByLabel("Phase title").fill("Rough-in");
    await phases.getByRole("button", { name: "Add phase" }).click();
    await expect(phases).toContainText("Rough-in");

    const scheduling = page.getByRole("region", { name: "Scheduling" });
    await scheduling
      .getByRole("combobox", { name: /^Visit for/ })
      .selectOption({ label: "Phase 1: Rough-in" });
    await scheduling.getByLabel("Start").fill("2030-05-01T09:00");
    await scheduling.getByLabel("End").fill("2030-05-01T10:00");
    await scheduling.getByRole("button", { name: "Book" }).click();
    await expect(scheduling.getByRole("table", { name: "Visits" })).toContainText(
      "Phase 1: Rough-in",
    );
    // The phase is now scheduled, and has a visit so it isn't offered again.
    await expect(phases.getByRole("table", { name: "Phases of this job" })).toContainText(
      "Scheduled",
    );
    await expect(scheduling.getByRole("combobox", { name: /^Visit for/ })).toHaveCount(0);
  });

  test("parts and labour are recorded by phase, with totals for each phase and the job", async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, jobId } = await newJob();
    await signIn(page, email);
    await page.goto(`/app/work-orders/${jobId}`);
    const phases = page.getByRole("region", { name: "Phases" });
    await phases.getByLabel("Phase title").fill("Install the new furnace");
    await phases.getByRole("button", { name: "Add phase" }).click();
    await expect(phases).toContainText("Install the new furnace");

    const lines = page.getByRole("region", { name: "Parts and labour" });
    // A part for the phase ($250.00) and labour for the whole job (60 minutes at $90 = $90.00).
    await lines
      .getByRole("combobox", { name: /^For/ })
      .first()
      .selectOption({ label: "Phase 1: Install the new furnace" });
    await lines.getByLabel("Description").fill("Furnace");
    await lines.getByLabel("Price ($)").fill("250");
    await lines.getByRole("button", { name: "Add part" }).click();
    await expect(lines.getByRole("table", { name: "Parts used" })).toContainText(
      "Phase 1: Install the new furnace",
    );
    await lines.getByLabel("Minutes").fill("60");
    await lines.getByLabel("Hourly rate ($)").fill("90");
    await lines.getByRole("button", { name: "Add labour" }).click();
    await expect(lines.getByRole("table", { name: "Labour" })).toContainText("Whole job");

    await expect(lines.getByLabel("Job totals")).toContainText("$340.00");
    await expect(lines.getByLabel("Totals by phase")).toContainText("$250.00");

    // A phase with parts recorded can't be removed.
    await phases.getByRole("button", { name: "Remove phase 1" }).click();
    await expect(phases.getByText(/can't be removed/)).toBeVisible();
  });

  test("has no accessibility violations and fits a phone", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, jobId } = await newJob();
    await signIn(page, email);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/app/work-orders/${jobId}`);
    const phases = page.getByRole("region", { name: "Phases" });
    await phases.getByLabel("Phase title").fill("Rough-in");
    await phases.getByRole("button", { name: "Add phase" }).click();
    await expect(phases).toContainText("Rough-in");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
