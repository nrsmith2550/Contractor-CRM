import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ENTITIES } from "@/entities";
import { activateLicense } from "@/server/auth/activation";
import { createAccount } from "@/server/domain/accounts";
import { buildCtx } from "@/server/domain/context";
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

test.describe("export", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("downloads the view as Excel or CSV, honouring the search", async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
    const { email, tenantId, ownerId } = await newBusiness();
    const c = await buildCtx(tenantId, ownerId);
    ok(await createAccount(c, { name: "Northwind Plumbing" }));
    ok(await createAccount(c, { name: "=cmd|calc, Evil Heating" }));
    ok(await createAccount(c, { name: "Contoso Roofing" }));

    await signIn(page, email);
    await page.goto("/app/accounts");
    await expect(page.getByRole("link", { name: "Northwind Plumbing" })).toBeVisible();

    // CSV of the whole view.
    let [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export to CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^accounts-\d{4}-\d{2}-\d{2}\.csv$/);
    let text = readFileSync((await download.path())!, "utf8");
    expect(text.startsWith("\ufeff")).toBe(true);
    expect(text.split("\r\n")[0]).toBe(
      `\ufeff${ENTITIES.account.columns.map((x) => x.label).join(",")}`,
    );
    expect(text).toContain("Northwind Plumbing");
    expect(text).toContain("Contoso Roofing");
    expect(text).toContain(`"'=cmd|calc, Evil Heating"`); // a formula in the data is defused

    // Excel of the whole view is a real zip package.
    [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export to Excel" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = readFileSync((await download.path())!);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.includes(Buffer.from("xl/worksheets/sheet1.xml"))).toBe(true);
    expect(bytes.includes(Buffer.from("Northwind Plumbing"))).toBe(true);

    // The export follows the search, not just the page on screen.
    await page.getByLabel("Search", { exact: true }).fill("Contoso");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/q=Contoso/);
    [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export to CSV" }).click(),
    ]);
    text = readFileSync((await download.path())!, "utf8");
    expect(text).toContain("Contoso Roofing");
    expect(text).not.toContain("Northwind");
  });
});
