import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "CRM" })).toBeVisible();
});

test("health endpoint reports database connectivity", async ({ request }) => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL not set");
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, db: "ok" });
});
