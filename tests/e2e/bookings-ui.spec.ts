import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type Page } from "@playwright/test";
import { withTenant } from "@/db/client";
import { resourceBooking, securityRole, workOrder } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { acceptInvitation, inviteUser } from "@/server/auth/invitations";
import { createBooking } from "@/server/domain/bookings";
import { createProduct } from "@/server/domain/catalog";
import { listWorkOrderLines } from "@/server/domain/work-order-lines";
import { buildCtx } from "@/server/domain/context";
import { createResource } from "@/server/domain/resources";
import { createWorkOrder } from "@/server/domain/work-orders";
import { mintLicense } from "@/server/licensing/mint";
import { utcToZonedInput, zonedToUtc } from "@/lib/tz";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function newBusiness(timeZone: string) {
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
    timeZone,
    currency: "USD",
    ip: `ip-${id}`,
  });
  if (!res.ok) throw new Error(`activation failed: ${res.code}`);
  return { id, email, tenantId: res.tenantId, ownerId: res.userId };
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

test.describe("bookings UI", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("a dispatcher sets up a resource, books a work order and sees the warnings", async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const biz = await newBusiness("America/New_York");
    await signIn(page, biz.email);

    // A skill, and a resource without it.
    await page.goto("/app/settings/service");
    await page.getByLabel("Skill name").fill("HVAC certified");
    await page.getByRole("button", { name: "Add skill" }).click();
    await expect(page.getByRole("list", { name: "Skills" })).toContainText("HVAC certified");

    await page.goto("/app/team");
    await page.getByLabel("Name", { exact: true }).fill("Crew A");
    await page.getByRole("button", { name: "Add team member" }).click();
    await expect(page.getByText("Crew A added.")).toBeVisible();
    await expect(page.getByRole("table", { name: "Team members" })).toContainText("Crew A");

    // Bad working hours are refused with a message.
    await page.getByRole("link", { name: "Crew A" }).click();
    // (retried: filling before the page has finished loading gets reset when it does)
    await expect(async () => {
      await page.getByLabel("Monday").fill("9am to 5pm");
      await expect(page.getByLabel("Monday")).toHaveValue("9am to 5pm");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.locator(".crm-error")).toContainText("Working hours for MON", {
        timeout: 2000,
      });
    }).toPass({ timeout: 15_000 });
    await page.getByLabel("Monday").fill("08:00-17:00");

    // A work order that needs the skill.
    await page.goto("/app/jobs/new");
    await page.getByLabel("Title").fill("Service the furnace");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/jobs\/[0-9a-f-]{36}$/);
    await page.getByRole("checkbox", { name: "HVAC certified" }).check();
    await page.getByRole("button", { name: "Save required skills" }).click();
    await expect(page.getByText("Required skills saved")).toBeVisible();

    // Book it for 8pm (outside hours) on a resource that lacks the skill: it books, with warnings.
    await page.getByLabel("Start", { exact: true }).fill("2030-05-01T20:00");
    await page.getByLabel("End", { exact: true }).fill("2030-05-01T21:00");
    await page.getByRole("button", { name: "Book", exact: true }).click();
    const warnings = page.getByRole("group", { name: "Visit warnings" });
    await expect(warnings).toContainText("outside Crew A's working hours");
    await expect(warnings).toContainText("doesn't have: HVAC certified");
    const bookings = page.getByRole("table", { name: "Visits" });
    await expect(bookings).toContainText("Crew A");
    await expect(bookings).toContainText("Scheduled");
    await expect(page.getByText("Scheduled", { exact: true }).first()).toBeVisible();

    // Cancel: the work order is Unscheduled again and can be rebooked inside working hours, no warnings.
    await page.getByRole("button", { name: "Cancel visit for Crew A" }).click();
    await expect(bookings).toContainText("Cancelled");
    await page.getByLabel("Start", { exact: true }).fill("2030-05-01T09:00");
    await page.getByLabel("End", { exact: true }).fill("2030-05-01T10:00");
    await page.getByRole("button", { name: "Book", exact: true }).click();
    await expect(page.getByText("Booked.")).toBeVisible();
    // 9am New York is inside Crew A's hours (the hours warning is gone); the skill warning remains.
    const again = page.getByRole("group", { name: "Visit warnings" });
    await expect(again).toContainText("doesn't have: HVAC certified");
    await expect(again).not.toContainText("working hours");

    // Parts and labour: a write-in part ($89.50) and 90 minutes at $95/hour ($142.50).
    const lines = page.getByRole("region", { name: "Parts and labour" });
    await lines.getByLabel("Description").fill("Igniter (special order)");
    await lines.getByLabel("Price ($)").fill("89.50");
    await lines.getByRole("button", { name: "Add part" }).click();
    await expect(lines.getByRole("table", { name: "Parts used" })).toContainText("$89.50");
    await lines.getByLabel("Minutes").fill("90");
    await lines.getByLabel("Hourly rate ($)").fill("95");
    await lines.getByRole("button", { name: "Add labour" }).click();
    await expect(lines.getByRole("table", { name: "Labour" })).toContainText("$142.50");
    await expect(lines.getByLabel("Job totals")).toContainText("$232.00");
    await lines.getByRole("button", { name: "Remove part 1" }).click();
    await expect(lines.getByLabel("Job totals")).toContainText("$142.50");
  });

  test("a technician runs a visit from their phone and captures a signature", async ({
    browser,
  }) => {
    const biz = await newBusiness("America/New_York");
    const admin = await buildCtx(biz.tenantId, biz.ownerId);

    // A technician, invited and accepted the real way, with a resource tied to their sign-in.
    const roleId = (
      await withTenant(biz.tenantId, (tx) =>
        tx
          .select({ id: securityRole.id })
          .from(securityRole)
          .where(eq(securityRole.name, "Field Technician")),
      )
    )[0]!.id;
    const techEmail = `tech-${biz.id}@example.test`;
    const mail: { text: string }[] = [];
    await inviteUser(
      { tenantId: biz.tenantId, inviterId: biz.ownerId, email: techEmail, roleId },
      { send: async (e) => void mail.push(e), appUrl: "https://app.test" },
    );
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail[0]!.text)![1]!;
    const accepted = await acceptInvitation({
      token,
      values: { fullName: "Tess Technician", password: PASSWORD, confirmPassword: PASSWORD },
      ip: `ip-${rand()}`,
    });
    if (!accepted.ok) throw new Error(`accept failed: ${accepted.code}`);

    const filter = await createProduct(admin, {
      sku: `F-${biz.id}`,
      name: "Furnace filter",
      listPriceCents: 2499,
    });
    if (!filter.ok) throw new Error(filter.message);
    const resource = await createResource(admin, { name: "Tess", userId: accepted.userId });
    if (!resource.ok) throw new Error(resource.message);
    const wo = await createWorkOrder(admin, {
      title: "Replace the igniter",
      instructions: "Gate code 4411. Dog in the yard.",
      addressStreet: "1 Main St",
      addressCity: "Pittsburgh",
      addressRegion: "PA",
      addressPostalCode: "15201",
    });
    if (!wo.ok) throw new Error(wo.message);
    const today = utcToZonedInput(new Date(), "America/New_York").slice(0, 10);
    const booked = await createBooking(admin, {
      workOrderId: wo.workOrder.id,
      resourceId: resource.resource.id,
      startAt: zonedToUtc(`${today}T09:00`, "America/New_York"),
      endAt: zonedToUtc(`${today}T11:00`, "America/New_York"),
    });
    if (!booked.ok) throw new Error(booked.message);

    // A phone-sized screen.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { "x-real-ip": fakeIp() },
    });
    const page = await ctx.newPage();
    await signIn(page, techEmail);
    // The site map is still reachable on a phone.
    await page
      .getByRole("navigation", { name: "Site map" })
      .getByRole("link", { name: "My visits" })
      .click();
    await expect(page).toHaveURL(/\/app\/my-visits$/);
    await expect(page.getByRole("heading", { name: "My visits" })).toBeVisible();
    const card = page.getByRole("article", { name: /Replace the igniter/ });
    await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
    await expect(card).toContainText("9:00 AM – 11:00 AM");
    await expect(card).toContainText("1 Main St");
    await expect(card).toContainText("Pittsburgh, PA, 15201");
    await expect(card).toContainText("Gate code 4411");

    // The page fits the phone: no sideways scrolling, and the buttons are big enough to tap.
    const wide = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 6)
        .map(
          (e) =>
            `${e.tagName}.${(e as HTMLElement).className} right=${Math.round(e.getBoundingClientRect().right)}`,
        ),
    );
    expect(wide, "elements wider than the screen").toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const box = await card.getByRole("button", { name: "I'm on my way" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    await card.getByRole("button", { name: "I'm on my way" }).click();
    await expect(card).toContainText("Travelling");
    await card.getByRole("button", { name: "Start work" }).click();
    await expect(card).toContainText("In progress");

    // Record the parts used: picked from the catalogue by name, priced by the catalogue.
    const parts = card.getByRole("region", { name: "Parts used" });
    await parts
      .getByRole("combobox", { name: "Part" })
      .selectOption({ label: `Furnace filter (F-${biz.id})` });
    await parts.getByLabel("Quantity").fill("2");
    await parts.getByRole("button", { name: "Add part" }).click();
    await expect(parts).toContainText("2 × Furnace filter");
    const recorded = await listWorkOrderLines(admin, wo.workOrder.id);
    if (!recorded.ok) throw new Error(recorded.message);
    expect(recorded.parts).toHaveLength(1);
    expect(recorded.parts[0]).toMatchObject({ unitPriceCents: 2499, extendedCents: 4998 });
    expect(JSON.stringify(await page.content())).not.toContain("24.99"); // technicians don't see prices

    // Finish: sign without a name is refused; with a name it completes.
    await card.getByRole("button", { name: "Finish visit" }).click();
    const pad = card.getByTestId("signature-pad");
    const r = (await pad.boundingBox())!;
    await page.mouse.move(r.x + 20, r.y + 40);
    await page.mouse.down();
    await page.mouse.move(r.x + 80, r.y + 10, { steps: 6 });
    await page.mouse.move(r.x + 140, r.y + 50, { steps: 6 });
    await page.mouse.move(r.x + 200, r.y + 20, { steps: 6 });
    await page.mouse.up();
    await card.getByLabel("Notes").fill("Replaced the igniter");
    await card.getByRole("button", { name: "Complete visit" }).click();
    await expect(card.locator(".crm-error")).toContainText("name of the person who signed");
    await card.getByLabel("Customer name").fill("Pat Customer");
    await card.getByRole("button", { name: "Complete visit" }).click();
    await expect(card).toContainText("Completed. Signed by Pat Customer.");

    // Stored: the booking is completed with a real PNG signature, and the work order is completed.
    const [b] = await withTenant(biz.tenantId, (tx) =>
      tx.select().from(resourceBooking).where(eq(resourceBooking.workOrderId, wo.workOrder.id)),
    );
    expect(b).toMatchObject({ status: "completed", signedByName: "Pat Customer" });
    expect(b!.signatureDataUrl!.startsWith("data:image/png;base64,")).toBe(true);
    const png = Buffer.from(b!.signatureDataUrl!.split(",")[1]!, "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.length).toBeGreaterThan(200); // not a blank pad
    expect(b!.notes).toContain("Replaced the igniter");
    const [w] = await withTenant(biz.tenantId, (tx) =>
      tx.select().from(workOrder).where(eq(workOrder.id, wo.workOrder.id)),
    );
    expect(w!.status).toBe("completed");
    await ctx.close();
  });
});
