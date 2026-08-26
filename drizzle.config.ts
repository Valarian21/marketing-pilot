import { defineConfig } from "drizzle-kit";

// Only used to generate SQL migrations from src/server/db/schema.ts
// (`pnpm db:generate`). Migrations are applied at server start.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dbCredentials: { url: process.env["MP_DATA_DIR"] ? `${process.env["MP_DATA_DIR"]}/mp.db` : "./data/mp.db" },
});
