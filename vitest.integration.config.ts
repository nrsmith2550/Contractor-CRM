import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests hit a real Postgres. Needs DATABASE_URL (restricted app role) and
// DATABASE_URL_OWNER (migrations role) with migrations + rls.sql already applied.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
