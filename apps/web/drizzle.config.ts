import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: DATABASE_URL },
});
