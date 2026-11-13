import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { withTenant } from "@/db/client";
import { resourceBooking, workOrder } from "@/db/schema";
import { activateLicense } from "@/server/auth/activation";
import { createBooking } from "@/server/domain/bookings";
import { buildCtx } from "@/server/domain/context";
import { createCharacteristic, createResource, updateResource } from "@/server/domain/resources";
import { createWorkOrder } from "@/server/domain/work-orders";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};
const DAY = "2030-05-01"; // a Wednesday; the business runs in UTC
const PX = 64; // pixels per hour on the day view
const url = (over = "") => `/app/schedule?view=day&date=${DAY}${over}`;

async function newBusiness() {
  const id = rand();
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Board Co ${id}`,
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
const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 3, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}
/** The x of an hour of the day on a row's lane (accounts for scrolling). */
const xAt = async (page: Page, resource: string, hour: number) =>
  (await page.locator(`[data-resource="${resource}"] .sb-lane`).boundingBox())!.x + hour * PX;
const rowY = async (page: Page, resource: string) =>
  (await center(page.locator(`[data-resource="${resource}"] .sb-lane`))).y;

const bookingOf = (tenantId: string, woId: string) =>
  withTenant(tenantId, (tx) =>
    tx.select().from(resourceBooking).where(eq(resourceBooking.workOrderId, woId)),
  ).then((rows) => rows.filter((r) => r.status !== "cancelled")[0]);
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

test.describe("schedule board", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("drop, move, reassign, resize, keyboard, menu, warnings and views", async ({
    page,
    context,
  }) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    // Wide enough that the drop points are well inside the board (the board auto-scrolls near its edges).
    await page.setViewportSize({ width: 1800, height: 1000 });
    const biz = await newBusiness();
    const admin = await buildCtx(biz.tenantId, biz.ownerId);
    const hvac = ok(await createCharacteristic(admin, { name: "HVAC certified" })).characteristic;
    const alpha = ok(await createResource(admin, { name: "Alpha", color: "#3366cc" })).resource;
    const bravo = ok(await createResource(admin, { name: "Bravo", color: "#cc6633" })).resource;
    ok(await updateResource(admin, bravo.id, { skillIds: [hvac.id] }));
    const booked = ok(await createWorkOrder(admin, { title: "Booked job" })).workOrder;
    const loose = ok(
      await createWorkOrder(admin, { title: "Loose job", estDurationMin: 90 }),
    ).workOrder;
    const third = ok(await createWorkOrder(admin, { title: "Third job" })).workOrder;
    ok(
      await createBooking(admin, {
        workOrderId: booked.id,
        resourceId: alpha.id,
        startAt: `${DAY}T09:00:00Z`,
        endAt: `${DAY}T11:00:00Z`,
      }),
    );

    await signIn(page, biz.email);
    await page
      .getByRole("navigation", { name: "Site map" })
      .getByRole("link", { name: "Schedule" })
      .click();
    await page.goto(url());
    await expect(page.getByRole("group", { name: "Schedule" })).toBeVisible();
    await expect(page.locator('[data-resource="Alpha"]')).toBeVisible();
    await expect(page.locator('[data-resource="Bravo"]')).toBeVisible();
    const bookedBlock = page.locator(`[data-booking]`).filter({ hasText: booked.woNumber });
    await expect(bookedBlock).toHaveAttribute("aria-label", /09:00–11:00, scheduled/);
    expect((await bookedBlock.boundingBox())!.width).toBeCloseTo(2 * PX, 0); // two hours wide
    await expect(page.getByRole("region", { name: "Unscheduled jobs" })).toContainText("Loose job");
    await expect(page.getByRole("region", { name: "Unscheduled jobs" })).not.toContainText(
      "Booked job",
    );

    // 1. Drag an unscheduled work order onto Alpha at 13:00: it is booked for its 90 minutes.
    const card = page.locator(`[data-wo="${loose.id}"]`);
    await drag(page, await center(card), {
      x: (await xAt(page, "Alpha", 13)) + 4,
      y: await rowY(page, "Alpha"),
    });
    const looseBlock = page.locator(`[data-booking]`).filter({ hasText: loose.woNumber });
    await expect(looseBlock).toBeVisible();
    await expect(page.getByRole("region", { name: "Unscheduled jobs" })).not.toContainText(
      "Loose job",
    );
    let b = (await bookingOf(biz.tenantId, loose.id))!;
    expect([hhmm(b.startAt), hhmm(b.endAt), b.resourceId]).toEqual(["13:00", "14:30", alpha.id]);
    const [w1] = await withTenant(biz.tenantId, (tx) =>
      tx.select().from(workOrder).where(eq(workOrder.id, loose.id)),
    );
    expect(w1!.status).toBe("scheduled");

    // 2. Drag it to Bravo and an hour later: reassigned and moved, keeping its length.
    const from = await center(looseBlock);
    await drag(page, from, { x: from.x + PX, y: await rowY(page, "Bravo") });
    await expect(
      page.locator('[data-resource="Bravo"] [data-booking]').filter({ hasText: loose.woNumber }),
    ).toBeVisible();
    b = (await bookingOf(biz.tenantId, loose.id))!;
    expect([hhmm(b.startAt), hhmm(b.endAt), b.resourceId]).toEqual(["14:00", "15:30", bravo.id]);

    // 3. Resize from the right edge by an hour.
    const moved = page.locator(`[data-booking]`).filter({ hasText: loose.woNumber });
    const handle = await center(moved.locator('[data-handle="end"]'));
    await drag(page, handle, { x: handle.x + PX, y: handle.y });
    await expect
      .poll(async () => hhmm((await bookingOf(biz.tenantId, loose.id))!.endAt))
      .toBe("16:30");
    expect(hhmm((await bookingOf(biz.tenantId, loose.id))!.startAt)).toBe("14:00");

    // 4. Keyboard: focus it, ArrowRight moves a quarter of an hour; Shift+ArrowLeft shortens it.
    await moved.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => hhmm((await bookingOf(biz.tenantId, loose.id))!.startAt))
      .toBe("14:15");
    await page.locator(`[data-booking]`).filter({ hasText: loose.woNumber }).focus();
    await page.keyboard.press("Shift+ArrowLeft");
    await expect
      .poll(async () => hhmm((await bookingOf(biz.tenantId, loose.id))!.endAt))
      .toBe("16:30"); // the move made it 14:15-16:45; shortening by a step gives 16:30
    await page.locator(`[data-booking]`).filter({ hasText: loose.woNumber }).focus();
    await page.keyboard.press("ArrowUp"); // up a row: back to Alpha
    await expect
      .poll(async () => (await bookingOf(biz.tenantId, loose.id))!.resourceId)
      .toBe(alpha.id);

    // 5. Dropping onto an occupied time warns (and still books): the third job on Alpha at 10:00.
    const thirdCard = page.locator(`[data-wo="${third.id}"]`);
    await drag(page, await center(thirdCard), {
      x: (await xAt(page, "Alpha", 10)) + 4,
      y: await rowY(page, "Alpha"),
    });
    const warnings = page.getByRole("group", { name: "Visit warnings" });
    await expect(warnings).toContainText("already booked");
    await expect(page.locator(`[data-booking]`).filter({ hasText: third.woNumber })).toBeVisible();

    // 6. Right-click: the menu opens the work order or cancels the booking.
    await page
      .locator(`[data-booking]`)
      .filter({ hasText: third.woNumber })
      .click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Open job" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Mark travelling" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Cancel visit" }).click();
    await expect(page.locator(`[data-booking]`).filter({ hasText: third.woNumber })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Unscheduled jobs" })).toContainText("Third job"); // back in the pane
    expect(await bookingOf(biz.tenantId, third.id)).toBeUndefined();

    // 6b. Outside working hours: the third job dropped at 06:00 (hours start at 08:00) books, with a warning.
    await drag(page, await center(page.locator(`[data-wo="${third.id}"]`)), {
      x: (await xAt(page, "Bravo", 6)) + 4,
      y: await rowY(page, "Bravo"),
    });
    await expect(page.getByRole("group", { name: "Visit warnings" })).toContainText(
      "outside Bravo's working hours",
    );
    await expect(
      page.locator('[data-resource="Bravo"] [data-booking]').filter({ hasText: third.woNumber }),
    ).toBeVisible();

    // 7. A booking that has started can't be dragged.
    await page
      .locator(`[data-booking]`)
      .filter({ hasText: booked.woNumber })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark in progress" }).click();
    await expect(
      page.locator(`[data-booking]`).filter({ hasText: booked.woNumber }),
    ).toHaveAttribute("data-status", "in_progress");
    await expect(
      page.locator(`[data-booking]`).filter({ hasText: booked.woNumber }).locator("[data-handle]"),
    ).toHaveCount(0);

    // 8. Views and navigation.
    await page.getByRole("link", { name: "Week" }).click();
    await expect(page).toHaveURL(/view=week/);
    await expect(page.locator(".sb-tick")).toHaveCount(7);
    await expect(page.locator(".sb-tick").first()).toContainText("Mon 4/29");
    await page.getByRole("link", { name: "Month" }).click();
    await expect(page.locator(".sb-tick")).toHaveCount(31);
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page.locator(".sb-tick")).toHaveCount(30); // June
    await expect(page.locator("[data-booking]")).toHaveCount(0);
    await page.goto(url("&skill=" + hvac.id));
    await expect(page.locator('[data-resource="Bravo"]')).toBeVisible();
    await expect(page.locator('[data-resource="Alpha"]')).toHaveCount(0); // only Bravo has the skill
  });

  test("renders 25 resources and 300 bookings quickly", async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const biz = await newBusiness();
    const admin = await buildCtx(biz.tenantId, biz.ownerId);
    const resources = [];
    for (let i = 0; i < 25; i++)
      resources.push(
        ok(await createResource(admin, { name: `Res ${String(i).padStart(2, "0")}` })).resource,
      );
    // 300 bookings across the week of 2030-04-29: 12 per resource, 3 per day on 4 days.
    let n = 0;
    for (let i = 0; i < 300; i++) {
      const r = resources[i % 25]!;
      const day = 29 + (Math.floor(i / 25) % 4); // Apr 29 .. May 2
      const hour = 8 + Math.floor(i / 100) * 3; // 8, 11, 14
      const wo = ok(await createWorkOrder(admin, { title: `Job ${i}` })).workOrder;
      const d = `${day <= 30 ? `2030-04-${day}` : `2030-05-0${day - 30}`}`;
      ok(
        await createBooking(admin, {
          workOrderId: wo.id,
          resourceId: r.id,
          startAt: `${d}T${String(hour).padStart(2, "0")}:00:00Z`,
          endAt: `${d}T${String(hour + 2).padStart(2, "0")}:00:00Z`,
        }),
      );
      n++;
    }
    expect(n).toBe(300);

    await signIn(page, biz.email);
    const t0 = Date.now();
    await page.goto("/app/schedule?view=week&date=2030-05-01", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-booking]")).toHaveCount(300, { timeout: 10_000 });
    const ms = Date.now() - t0;
    console.info(
      `[perf] schedule board, 25 resources x 300 bookings: ${ms} ms (navigation to all blocks drawn)`,
    );
    await expect(page.locator(".sb-row")).toHaveCount(25);
    expect(ms).toBeLessThan(3000); // the target is ~1 s on a laptop; this leaves headroom for a busy CI machine
  });
});
