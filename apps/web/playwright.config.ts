import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./src/config";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: BASE_URL },
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: {
      AUTH_DEV_LOGIN: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret",
      DATABASE_URL,
      // Every e2e spec that touches the AI compose path must exercise the
      // simulated model, never a real provider (token cost) — see
      // m10-simulated-ai.spec.ts's file header and m7-solo-delight.spec.ts's
      // "no e2e test may make a real call" note. Not present in
      // apps/web/.env.local, so this has to be set explicitly here rather
      // than relying on a developer's local file.
      AI_LIVE: "false",
    },
  },
});
