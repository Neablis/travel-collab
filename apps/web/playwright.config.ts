import { defineConfig } from "@playwright/test";
import { BASE_URL } from "./src/config";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  testDir: "./e2e",
  reporter: "line",
  // KI-19: the suite ran at Playwright's 1280x720 default with no viewport
  // set, which is why Wave 1's gate passed 11/11 while the page was inert
  // below 1180px. An explicit default plus a narrow project (added
  // separately) is what closes that blind spot.
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    // A failing CI run should hand back a trace, not a line of text. This
    // is what turned KI-21 from "intermittent, cause unknown" into a
    // precise trace-level diagnosis; make it the default rather than
    // something someone has to remember to enable while re-running a red
    // build.
    trace: "on-first-retry",
    video: "off",
  },
  // One retry in CI only. NOT a flake-suppression tool: a test that passes
  // on retry is reported as flaky and must be treated as a bug, not waved
  // through — see KI-1, where a real bug sat behind a "probably flake"
  // label for two weeks. Zero retries locally, so a local failure is
  // always a real signal.
  retries: process.env.CI ? 1 : 0,
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
