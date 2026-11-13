import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
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

/** The element that has keyboard focus, described, with whether it shows a visible focus indicator. */
const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const shadow = cs.boxShadow !== "none";
    const border = el.matches("input,select,textarea,button") && cs.borderTopColor !== "";
    return {
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
      visibleFocus: outline || shadow,
      border,
    };
  });

test.describe("keyboard", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("skip link, visible focus everywhere, and a whole task with the keyboard alone", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email } = await newBusiness();

    // Signing in by keyboard: Tab to the fields, type, Enter.
    await page.goto("/login");
    await page.getByLabel("Email").focus();
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Sales Hub" })).toBeVisible();

    // The first Tab stop is the skip link; it appears on screen, and Enter moves focus to the content.
    await page.goto("/app/leads");
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    const box = (await skip.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0); // slid into view
    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
    await page.keyboard.press("Tab");
    // After the skip, the next stop is inside the page content, not back in the sidebar.
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("nav[aria-label='Site map']")),
    ).toBe(false);

    // Every stop on the list page has a visible focus indicator, in both themes.
    for (const theme of ["light", "dark"]) {
      await page
        .context()
        .addCookies([{ name: "clinch-theme", value: theme, url: "http://localhost:3000" }]);
      await page.goto("/app/leads");
      await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
      const seen: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const f = await focused(page);
        if (!f) break;
        seen.push(`${f.tag}:${f.name}`);
        expect(f.visibleFocus, `${theme}: no visible focus on ${f.tag} "${f.name}"`).toBe(true);
      }
      expect(seen.length).toBeGreaterThan(15); // sidebar, top bar and the command bar were all reachable
      expect(seen.some((s) => s.includes("+ New"))).toBe(true);
      expect(seen.some((s) => s.includes("Export to Excel"))).toBe(true);
    }

    // Create a lead using only the keyboard: open the form from the list, fill it, save with Enter.
    await page.goto("/app/leads");
    await page.getByRole("link", { name: "+ New" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible();
    await page.getByLabel("Last name").focus();
    await page.keyboard.type("Keyboard");
    await page.getByLabel("Company").focus();
    await page.keyboard.type("Keys Ltd");
    await page.getByLabel("Email").focus();
    await page.keyboard.type("k@keys.test");
    await page.getByRole("button", { name: "Save" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/leads\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Keys Ltd").first()).toBeVisible();

    // The theme switch works from the keyboard too.
    await page.getByLabel("Theme").focus();
    await page.keyboard.press("ArrowDown"); // light -> next option
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "system");
  });

  test("the calendar toolbar and an event can be used without a mouse", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email } = await newBusiness();
    await signIn(page, email);
    await page.goto("/app/calendar");
    const cal = page.getByTestId("calendar");
    await expect(cal.locator(".fc-toolbar-title")).toBeVisible();
    const title = await cal.locator(".fc-toolbar-title").textContent();
    await cal.getByRole("button", { name: /next/i }).first().focus();
    await page.keyboard.press("Enter");
    await expect(cal.locator(".fc-toolbar-title")).not.toHaveText(title!);
    await cal.getByRole("button", { name: "Week", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(cal.locator(".fc-timeGridWeek-view")).toBeVisible();
  });
});
