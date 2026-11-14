import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { activateLicense } from "@/server/auth/activation";
import { createAccount, createContact } from "@/server/domain/accounts";
import { createBooking } from "@/server/domain/bookings";
import { convertToWorkOrder, createCase } from "@/server/domain/cases";
import { buildCtx } from "@/server/domain/context";
import { createResource } from "@/server/domain/resources";
import { mintLicense } from "@/server/licensing/mint";

const PASSWORD = "violet-lantern-orbit-42";

test.describe("related records", () => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");

  test("click from a customer to their person, request and job, and back again", async ({
    page,
  }) => {
    await page
      .context()
      .setExtraHTTPHeaders({ "x-real-ip": `10.6.${Math.floor(Math.random() * 250)}.3` });
    const id = randomBytes(4).toString("hex");
    const { key } = await mintLicense({ tier: "team" });
    const email = `rel-${id}@example.test`;
    const res = await activateLicense({
      licenseKey: key,
      companyName: `Links Co ${id}`,
      ownerName: "Jordan Rivers",
      ownerEmail: email,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      timeZone: "UTC",
      currency: "USD",
      ip: `ip-${id}`,
    });
    if (!res.ok) throw new Error(`activation failed: ${res.code}`);
    const c = await buildCtx(res.tenantId, res.userId);
    const acct = await createAccount(c, { name: `Buyer ${id}` });
    if (!acct.ok) throw new Error("account");
    const pers = await createContact(c, {
      firstName: "Sam",
      lastName: `Ng${id}`,
      parentAccountId: acct.account.id,
    });
    if (!pers.ok) throw new Error("contact");
    const req = await createCase(c, {
      title: `Gate sticks ${id}`,
      customerAccountId: acct.account.id,
    });
    if (!req.ok) throw new Error("case");
    const job = await convertToWorkOrder(c, req.case.id);
    if (!job.ok) throw new Error("job");

    const tech = await createResource(c, { name: `Tech ${id}`, userId: res.userId });
    if (!tech.ok) throw new Error("resource");
    const visit = await createBooking(c, {
      workOrderId: job.workOrder.id,
      resourceId: tech.resource.id,
      startAt: new Date("2030-05-01T13:00:00Z"),
      endAt: new Date("2030-05-01T15:00:00Z"),
    });
    if (!visit.ok) throw new Error("visit");

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();

    // Customer: everything linked to it is listed, grouped.
    await page.goto(`/app/customers/${acct.account.id}`);
    const related = page.getByRole("region", { name: "Related records" });
    await expect(related.getByRole("heading", { name: /^People/ })).toBeVisible();
    await expect(related.getByRole("heading", { name: /^Support requests/ })).toBeVisible();
    await expect(related.getByRole("heading", { name: /^Jobs/ })).toBeVisible();

    // To the person, and back to the customer from there.
    await related.getByRole("link", { name: `Sam Ng${id}` }).click();
    await expect(page).toHaveURL(new RegExp(`/app/people/${pers.contact.id}$`));
    await page
      .getByRole("region", { name: "Related records" })
      .getByRole("link", { name: `Buyer ${id}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/app/customers/${acct.account.id}$`));

    // To the support request, then on to its job, then back to the request and the customer.
    const inRelated = () => page.getByRole("region", { name: "Related records" });
    await inRelated().locator(`a[href="/app/support-requests/${req.case.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/support-requests/${req.case.id}$`));
    await inRelated().locator(`a[href="/app/jobs/${job.workOrder.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.workOrder.id}$`));
    await expect(
      inRelated().locator(`a[href="/app/support-requests/${req.case.id}"]`),
    ).toBeVisible();
    await inRelated().locator(`a[href="/app/customers/${acct.account.id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/app/customers/${acct.account.id}$`));

    // The customer and person fields on a form open their record.
    await page.goto(`/app/support-requests/${req.case.id}`);
    await page.getByRole("link", { name: `Open Buyer ${id}` }).click();
    await expect(page).toHaveURL(new RegExp(`/app/customers/${acct.account.id}$`));

    // A visit is reachable from the customer, shows who and when, and links back to its job.
    const visitHref = `/app/visits/${visit.booking.id}`;
    await page
      .getByRole("region", { name: "Related records" })
      .getByRole("heading", { name: /^Visits/ })
      .waitFor();
    await page.locator(`a[href="${visitHref}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${visitHref}$`));
    await expect(page.getByText(`Tech ${id}`).first()).toBeVisible();
    await page.locator(`a[href="/app/jobs/${job.workOrder.id}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/app/jobs/${job.workOrder.id}$`));
    await expect(inRelated().locator(`a[href="${visitHref}"]`)).toBeVisible();
  });
});
