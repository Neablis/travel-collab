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

// `src/server/api-tokens` refuses to mint or verify without a pepper, on purpose
// — an empty one would still produce a stable digest, so tokens would keep
// working while the property the key exists for silently did not hold. `||=`,
// not `??=`: `pnpm setup` has shipped `.env.local` with `API_TOKEN_PEPPER=`, and
// an empty string is not nullish, so `??=` kept the blank and 86 tests threw
// (KI-2026-09-19-a). A real value from `.env.local` or CI is still left alone;
// this only has to be present and stable within a run, because nothing asserts
// a digest against a fixture.
process.env.API_TOKEN_PEPPER ||= "test-pepper-not-a-real-key";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.int.test.ts"],
    fileParallelism: false,
    reporters: ["dot"],
  },
});
