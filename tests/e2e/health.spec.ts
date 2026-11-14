import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Win the work. Run the work." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Gantry CRM home" })).toBeVisible();
});

test("health endpoint reports database connectivity", async ({ request }) => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, db: "ok" });
});
