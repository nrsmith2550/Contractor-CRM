import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  // Migrations run as the owner role, never the restricted app role.
  dbCredentials: { url: process.env.DATABASE_URL_OWNER ?? "" },
});
