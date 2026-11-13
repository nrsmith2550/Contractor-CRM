import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { mintLicense } from "@/server/licensing/mint";
import { PNG_1PX } from "../support/images";

const PASSWORD = "violet-lantern-orbit-42";
const rand = () => randomBytes(4).toString("hex");
const fakeIp = () => {
  const o = () => 1 + Math.floor(Math.random() * 253);
  return `10.${o()}.${o()}.${o()}`;
};

async function signInNewBusiness(page: Page, context: BrowserContext) {
  await context.setExtraHTTPHeaders({ "x-real-ip": fakeIp() });
  const id = rand();
  const { key } = await mintLicense({ tier: "team" });
  const email = `owner-${id}@example.test`;
  const res = await activateLicense({
    licenseKey: key,
    companyName: `Quote Co ${id}`,
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
  await expect(page.getByRole("heading", { name: "Sales Hub" })).toBeVisible();
  return { id, email };
}

test.describe("quotes UI", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("catalog, quote builder, activate, revise, win and order", async ({ page, context }) => {
    const { id } = await signInNewBusiness(page, context);

    // A tax rate, then a product that uses it.
    await page.goto("/app/settings/tax-rates");
    await page.getByLabel("Name").fill("State tax");
    await page.getByLabel("Rate (%)").fill("7");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("State tax: 7.00%")).toBeVisible();

    const sku = `W-${id}`;
    await page.goto("/app/products/new");
    await page.getByLabel("SKU").fill(sku);
    await page.getByLabel("Name").fill("Widget");
    await page.getByLabel("List price").fill("19.99");
    await page.getByLabel("Tax rate").selectOption({ label: "State tax (7.00%)" });
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/products\/[0-9a-f-]{36}$/);

    // A quote with 3 widgets: 3 x 19.99 = 59.97, 7% tax = 4.20, total 64.17.
    await page.goto("/app/quotes/new");
    await page.getByLabel("Name").fill("Fence job");
    await page.getByRole("button", { name: "Create quote" }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]{36}$/);
    await page
      .getByRole("combobox", { name: "Product or service", exact: true })
      .selectOption({ label: `Widget (${sku})` });
    await page.getByLabel("Quantity").fill("3");
    await page.getByRole("button", { name: "Add line" }).click();
    await expect(page.getByLabel("Totals")).toContainText("$64.17");
    await expect(page.getByRole("table", { name: "Quote lines" })).toContainText("Widget");

    // Upload a logo (Settings -> Branding) before generating the PDF.
    const quoteUrl = page.url();
    await page.goto("/app/settings/branding");
    await page.getByLabel(/^Logo/).setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_1PX.split(",")[1]!, "base64"),
    });
    await expect(page.getByText("Logo saved.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Current company logo" })).toBeVisible();
    await page.goto(quoteUrl);
    await expect(page.getByLabel("Totals")).toContainText("$64.17");

    // Active quotes are read-only.
    await page.getByRole("button", { name: "Activate quote" }).click();
    await expect(page.getByText("This quote is active")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add line" })).toHaveCount(0);

    // The PDF downloads as a real PDF; a draft's would be refused.
    const href = await page.getByRole("link", { name: "Download PDF" }).getAttribute("href");
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Email the quote: the dev mail transport keeps the message and its PDF attachment as files.
    const buyer = `buyer-${id}@example.test`;
    await page.getByRole("button", { name: "Email quote" }).click();
    await page.getByRole("textbox", { name: "To", exact: true }).fill(buyer);
    await page.getByLabel("Message (optional)").fill("Thanks for your time");
    await page.getByRole("button", { name: "Send quote" }).click();
    await expect(page.getByText(`Quote emailed to ${buyer}.`)).toBeVisible();
    await expect(page.getByRole("list", { name: "Emails sent" })).toContainText(
      "Quote QUO-01001 from",
    );
    const safe = buyer.replace(/[^a-z0-9@.]+/gi, "_");
    let files: string[] = [];
    await expect
      .poll(async () => {
        files = (await readdir(".dev-mail-e2e").catch(() => [] as string[])).filter((f) =>
          f.includes(`-${safe}`),
        );
        return (
          files.some((f) => f.endsWith("QUO-01001.pdf")) && files.some((f) => f.endsWith(".txt"))
        );
      })
      .toBe(true);
    const attachment = await readFile(
      `.dev-mail-e2e/${files.find((f) => f.endsWith("QUO-01001.pdf"))!}`,
    );
    expect(attachment.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(
      await readFile(`.dev-mail-e2e/${files.find((f) => f.endsWith(".txt"))!}`, "utf8"),
    ).toContain("Thanks for your time");

    // Revise creates -R1 as a draft.
    await page.getByRole("button", { name: "Revise" }).click();
    await expect(page.getByRole("heading", { name: "Fence job" })).toBeVisible();
    await expect(page.getByText("Quote QUO-01001-R1")).toBeVisible();
    await page.getByRole("button", { name: "Activate quote" }).click();

    // Winning creates the order.
    await page.getByRole("button", { name: "Close as won" }).click();
    await expect(page).toHaveURL(/\/app\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("Order ORD-01001")).toBeVisible();
    await expect(page.getByRole("table", { name: "Order lines" })).toContainText("Widget");
  });

  test("opportunity product lines calculate revenue and copy into a new quote", async ({
    page,
    context,
  }) => {
    const { id } = await signInNewBusiness(page, context);

    const sku = `P-${id}`;
    await page.goto("/app/products/new");
    await page.getByLabel("SKU").fill(sku);
    await page.getByLabel("Name").fill("Gutter guard");
    await page.getByLabel("List price").fill("12.50");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/products\/[0-9a-f-]{36}$/);

    // An opportunity via a qualified lead.
    await page.goto("/app/prospects/new");
    await page.getByLabel("Last name").fill(`Lines${id}`);
    await page.getByLabel("Company").fill(`Roofers ${id}`);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/app\/prospects\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Turn into a customer", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/deals\/[0-9a-f-]{36}$/);

    // Products: 4 x $12.50 = $50.00, plus a $30.00 write-in with a $5.00 discount.
    await page
      .getByRole("combobox", { name: "Product or service", exact: true })
      .selectOption({ label: `Gutter guard (${sku})` });
    await page.getByLabel("Quantity").fill("4");
    await page.getByRole("button", { name: "Add product or service" }).click();
    await expect(
      page.getByText("Estimated revenue is calculated from these lines: $50.00."),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Product or service", exact: true })
      .selectOption({ label: "Write-in (not in your list)" });
    await page.getByLabel("Description").fill("Install");
    await page.getByLabel("Quantity").fill("1");
    await page.getByLabel("Unit price ($)").fill("30");
    await page.getByLabel("Discount ($)").fill("5");
    await page.getByRole("button", { name: "Add product or service" }).click();
    await expect(
      page.getByText("Estimated revenue is calculated from these lines: $75.00."),
    ).toBeVisible();
    await expect(page.getByRole("table", { name: "Deal products and services" })).toContainText(
      "Install",
    );

    // The header shows the calculated revenue; remove a line and it follows.
    await expect(page.getByText("$75.00").first()).toBeVisible();
    await page.getByRole("button", { name: "Remove product or service 2" }).click();
    await expect(
      page.getByText("Estimated revenue is calculated from these lines: $50.00."),
    ).toBeVisible();
    await page.getByLabel("Description").fill("Install");
    await page.getByLabel("Quantity").fill("1");
    await page.getByLabel("Unit price ($)").fill("30");
    await page.getByLabel("Discount ($)").fill("5");
    await page.getByRole("button", { name: "Add product or service" }).click();
    await expect(page.getByText("calculated from these lines: $75.00.")).toBeVisible();

    // + New quote copies the lines.
    await page.getByRole("link", { name: "+ New quote" }).click();
    await page.getByLabel("Name").fill("From the opportunity");
    await page.getByRole("button", { name: "Create quote" }).click();
    await expect(page).toHaveURL(/\/app\/quotes\/[0-9a-f-]{36}$/);
    const lines = page.getByRole("table", { name: "Quote lines" });
    await expect(lines).toContainText("Gutter guard");
    await expect(lines).toContainText("Install");
    await expect(page.getByLabel("Totals")).toContainText("$75.00");
  });
});
