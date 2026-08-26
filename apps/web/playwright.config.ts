import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./src/config";
import { DATABASE_URL } from "./src/server/config";

export default defineConfig({
  testDir: "./e2e",
  // `line` in both lanes; locally a second reporter appends the lane warning
  // to a failing run. See e2e/laneReporter.ts for why this is a reporter and
  // not another paragraph of guidelines.
  reporter: process.env.CI ? "line" : [["line"], ["./e2e/laneReporter.ts"]],
  // KI-25: runs once, after webServer is up but before every project
  // (including "setup") — refuses to proceed if the running server would
  // make a real, billable model call, independent of how that server was
  // started. See e2e/global.setup.ts and /api/health/ai-mode.
  globalSetup: "./e2e/global.setup.ts",
  // CI builds first and serves with `next start`; locally `pnpm dev` compiles
  // each route on demand, and a cold compile can eat a whole test's budget
  // before the test does anything interesting. At Playwright's 30s default
  // that made local runs fail at whichever assertion the compile happened to
  // land on — a *wandering* failure point, which is what a timeout looks like
  // and a real defect does not. Chasing one of those cost a day and got
  // written off as "environmental"; it was this. CI keeps the strict budget,
  // because there the slowness would be a genuine regression.
  timeout: process.env.CI ? 30_000 : 120_000,
  // Same reason, the other half: an individual assertion defaults to 5s, and
  // the first visit to a route locally spends longer than that compiling it.
  // Raising only the test timeout just moves the failure to the first
  // `expect` after a cold navigation.
  expect: { timeout: process.env.CI ? 5_000 : 20_000 },
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
    // something someone has to remember to enable while re-running a real
    // failure.
    trace: "on-first-retry",
    video: "off",
  },
  // One retry in CI only. NOT a flake-suppression tool: a test that passes
  // on retry is reported as flaky and must be treated as a bug, not waved
  // through — see KI-1, where a real bug sat behind a "probably flake"
  // label for two weeks. Zero retries locally, so a local failure is
  // always a real signal.
  retries: process.env.CI ? 1 : 0,
  // Task 3.1: sign in once, not 24 times. "setup" authenticates as alice and
  // saves storageState; every other project depends on it and starts already
  // signed in. Shared-trip-list isolation is via the unique-trip-name
  // convention every spec already used before this change (`${name}
  // ${Date.now()}`), not per-worker users — a real alternative (see phase-3
  // plan), but the existing convention already works and a shared
  // storageState is the smaller change. Written down here per that plan's
  // "pick one and write it down" instruction.
  //
  // "narrow" (Task 3.4, KI-19) runs only e2e/responsive.spec.ts, below the
  // 1179px breakpoint where the assistant rail's overlay mode and other
  // breakpoint-dependent behavior live — the whole suite does not need to
  // run twice to catch that class of bug.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, storageState: ".auth/alice.json" },
      dependencies: ["setup"],
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: "narrow",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 800 }, storageState: ".auth/alice.json" },
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts/,
    },
  ],
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
