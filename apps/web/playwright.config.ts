import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./src/config";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  testDir: "./e2e",
  reporter: "line",
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
      // Auth.js v5 rejects requests from untrusted hosts under `next start`
      // (production mode) unless the platform sets this itself (Vercel does).
      // CI's workflow env already sets this for the job as a whole (see
      // ci.yml), which is why `pnpm start` there works without it appearing
      // here too — but `test:e2e:ci-like` (KI-27) invokes this config
      // directly with just `CI=true`, so it has to be self-sufficient rather
      // than depend on a workflow-level env var a developer wouldn't know to
      // set locally. Only needed in production mode; dev mode has no such
      // check, so it's omitted there rather than set unconditionally.
      ...(process.env.CI ? { AUTH_TRUST_HOST: "true" } : {}),
    },
  },
});
