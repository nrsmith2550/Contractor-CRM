import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { addActivity } from "@/server/domain/activities";
import { createBooking } from "@/server/domain/bookings";
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
  await expect(page.getByRole("heading", { name: "Sales Hub" })).toBeVisible();
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};
const cal = (page: Page) => page.getByTestId("calendar");
const open = async (page: Page) => {
  await page.goto("/app/calendar?date=2030-05-02");
  await expect(cal(page).locator(".fc-toolbar-title")).toContainText("May 2030");
};

test.describe("calendar", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("shows appointments, tasks and bookings in the business's zone, and adds an appointment", async ({
    page,
  }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, tenantId, ownerId } = await newBusiness();
    const c = await buildCtx(tenantId, ownerId);
    // 13:00 UTC is 9:00 in New York (daylight time in May).
    ok(
      await addActivity(c, {
        activityType: "appointment",
        subject: "Site walk",
        scheduledStart: "2030-05-02T13:00:00Z",
        scheduledEnd: "2030-05-02T14:00:00Z",
      }),
    );
    ok(
      await addActivity(c, {
        activityType: "task",
        subject: "Send the report",
        dueAt: "2030-05-03T19:00:00Z",
      }),
    );
    const res = ok(await createResource(c, { name: "Crew A", userId: ownerId })).resource;
    const wo = ok(await createWorkOrder(c, { title: "Fix furnace" })).workOrder;
    ok(
      await createBooking(c, {
        workOrderId: wo.id,
        resourceId: res.id,
        startAt: "2030-05-04T14:00:00Z",
        endAt: "2030-05-04T16:00:00Z",
      }),
    );

    await signIn(page, email);
    await open(page);

    // Month view shows all three.
    await expect(cal(page).getByText("Site walk")).toBeVisible();
    await expect(cal(page).getByText("Send the report")).toBeVisible();
    await expect(cal(page).getByText(`${wo.woNumber} Fix furnace`)).toBeVisible();

    // Details show the time in the business's zone and link to the record.
    await cal(page).getByText("Site walk").click();
    const details = page.getByRole("region", { name: "Event details" });
    await expect(details).toContainText("2030-05-02 09:00–10:00");
    await details.getByRole("button", { name: "Close" }).click();
    await cal(page).getByText(`${wo.woNumber} Fix furnace`).click();
    await details.getByRole("link", { name: "Open the record" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/jobs/${wo.id}$`));
    await page.goBack();

    // The other views.
    for (const view of ["Week", "Day", "Agenda", "Month"]) {
      await cal(page).getByRole("button", { name: view, exact: true }).click();
      await expect(cal(page).locator(".fc-view")).toBeVisible();
    }
    await cal(page).getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(cal(page).getByText("Site walk")).toBeVisible();
    await cal(page).getByRole("button", { name: "Month", exact: true }).click();

    // Add an appointment by clicking a day. The end can't come before the start.
    await expect(async () => {
      await cal(page).locator('.fc-daygrid-day[data-date="2030-05-07"]').click();
      await expect(page.getByRole("form", { name: "New appointment" })).toBeVisible({
        timeout: 1000,
      });
    }).toPass();
    const form = page.getByRole("form", { name: "New appointment" });
    await form.getByLabel("Subject").fill("Supplier visit");
    await form.getByLabel("Starts").fill("2030-05-07T11:00");
    await form.getByLabel("Ends").fill("2030-05-07T10:00");
    await form.getByRole("button", { name: "Add appointment" }).click();
    await expect(form.locator(".crm-error")).toBeVisible();
    await form.getByLabel("Ends").fill("2030-05-07T12:00");
    await form.getByRole("button", { name: "Add appointment" }).click();
    await expect(cal(page).getByText("Supplier visit")).toBeVisible();
    await cal(page).getByText("Supplier visit").click();
    await expect(details).toContainText("2030-05-07 11:00–12:00");
  });

  test("an administrator can switch to everyone's calendar", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, tenantId, ownerId } = await newBusiness();
    const c = await buildCtx(tenantId, ownerId);
    ok(
      await addActivity(c, {
        activityType: "appointment",
        subject: "Owner only",
        scheduledStart: "2030-05-02T13:00:00Z",
        scheduledEnd: "2030-05-02T14:00:00Z",
      }),
    );
    await signIn(page, email);
    await open(page);
    const who = page.getByLabel("Whose calendar");
    await expect(who).toBeVisible();
    await who.selectOption("all");
    await expect(cal(page).getByText("Owner only")).toBeVisible();
  });
});
