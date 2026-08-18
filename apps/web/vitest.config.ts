import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import path from "node:path";

// *.int.test.ts files import the real DB client, which needs DATABASE_URL —
// load .env.local before Vitest collects them, same as pnpm dev / test:e2e /
// the db:* scripts (see docs/guidelines/environments-and-deploys.md). A
// no-op when the file doesn't exist (CI supplies these via workflow env).
const envLocalPath = path.resolve(__dirname, ".env.local");
if (existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["src/**/*.int.test.ts"], fileParallelism: false },
});
