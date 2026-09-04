import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./src/config";
import { DATABASE_URL } from "./src/server/config";
import { E2E_SUPER_CODE } from "./e2e/admission";

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
  // The other half of that pair: deletes the `[e2e]`-prefixed trips this run
  // created, as their owner, while the server is still up. Every spec used to
  // leave its trips behind forever and the home grid fetches once per card
  // (KI-28), so the debris made each run slower — and its layout timing
  // different — than the last. See e2e/global.teardown.ts for the two
  // conditions that keep it off a real user's data.
  globalTeardown: "./e2e/global.teardown.ts",
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
  // 1179px breakpoint where the Playbooks grid's column reflow and other
  // breakpoint-dependent behavior live — the whole suite does not need to
  // run twice to catch that class of bug. The assistant rail used to be one
  // of those behaviors (an overlay below this breakpoint); M16 Wave 1 made
  // it a docked flex sibling at every width, so responsive.spec.ts now
  // checks it explicitly at both 1280px and 1100px rather than relying on
  // this project's own viewport to be the "below 1180px" case.
  //
  // "phone" (KI-84 mobile fix, PR #88): a real phone viewport, below the
  // 768px breakpoint where the assistant rail stops being a docked flex
  // sibling and becomes a full-screen surface (`.assistant-rail`,
  // globals.css). 411×852 is Mitchell's own reported device — the report
  // this fix answers, not an arbitrary choice — and e2e/m16-mobile-assistant
  // .spec.ts is scoped to it the same way responsive.spec.ts is scoped to
  // "narrow": one project per breakpoint-dependent behavior, not the whole
  // suite run a third time.
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, storageState: ".auth/alice.json" },
      dependencies: ["setup"],
      // Every breakpoint-specific spec, or the desktop project runs it too — at
      // 1280px, where the phone branch it is about does not exist. That is what
      // happened the first time `m14-mobile-notebook` landed: it passed in
      // "phone" and failed twice in "desktop", looking for a bind sheet a
      // desktop correctly does not have. The two lists have to be kept in step.
      testIgnore: [/responsive\.spec\.ts/, /m16-mobile-assistant\.spec\.ts/, /m14-mobile-notebook\.spec\.ts/],
    },
    {
      name: "narrow",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1100, height: 800 }, storageState: ".auth/alice.json" },
      dependencies: ["setup"],
      testMatch: /responsive\.spec\.ts/,
    },
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 411, height: 852 }, storageState: ".auth/alice.json" },
      dependencies: ["setup"],
      // Both phone specs, not one: M14 gave the Notebook a phone treatment
      // of its own (SPEC §19), and it is a different breakpoint behaviour
      // rather than a restyle — the chrome row becomes a sheet.
      testMatch: /(m16-mobile-assistant|m14-mobile-notebook)\.spec\.ts/,
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
      // M11a: every dev user this suite signs in is brand new against a fresh
      // database, and the gate refuses anyone with no `users` row and no
      // credential — so without this the run dies in `auth.setup.ts` and every
      // project fails for a reason that looks nothing like the gate. Pinned to
      // the constant rather than `process.env.INVITE_SUPER_CODE ?? …`: the
      // specs present this exact string, so a developer's own value in
      // `.env.local` must not be what the server ends up trusting.
      INVITE_SUPER_CODE: E2E_SUPER_CODE,
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
