// Loads apps/web/.env.local into process.env before playwright.config.ts's
// own top-level imports run (it imports DATABASE_URL/BASE_URL eagerly, which
// throw immediately if unset). `node --env-file-if-exists` can't be used
// here the way it is for the db:* scripts and drizzle-kit, since `playwright
// test` isn't invoked as a plain `node <script>` — this is preloaded instead
// via NODE_OPTIONS="--import ./scripts/preload-dotenv.mjs" (see test:e2e in
// package.json), which Node guarantees runs before the main entry point's
// own imports are evaluated.
//
// No-ops silently when .env.local doesn't exist (CI supplies these via the
// workflow env instead, same as every other script here).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envLocalPath = fileURLToPath(new URL("../.env.local", import.meta.url));
if (existsSync(envLocalPath)) {
  process.loadEnvFile(envLocalPath);
}
