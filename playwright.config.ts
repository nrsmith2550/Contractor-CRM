import { defineConfig } from "@playwright/test";

// Fixed test-only key so the test process and the server it starts can both encrypt/decrypt the
// platform admins' authenticator secrets. Never used outside tests.
process.env.ADMIN_TOTP_KEY ??= Buffer.alloc(32, 7).toString("base64");

export default defineConfig({
  testDir: "tests/e2e",
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    // Optional: point at a preinstalled Chromium instead of the version Playwright downloads.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000/",
    reuseExistingServer: !process.env.CI,
    // Dev mail is written to files (never logged) so tests can follow the emailed links.
    env: { EMAIL_DEV_DIR: ".dev-mail-e2e", APP_URL: "http://localhost:3000" },
    timeout: 120_000,
  },
});
