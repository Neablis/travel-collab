import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { BASE_URL } from "./src/config";

// Four .ts files that need a document despite not rendering React — see
// docs/plans/test-overhaul/phase-0-baseline.md Task 0.2 and
// scripts/classify-test-envs.mjs for why each one does. Don't "clean these
// up" without re-running that classifier. They are named twice below: once
// to pull them into the jsdom project, once to keep them out of the node one.
const JSDOM_TS_FILES = [
  "src/components/board/resolveDrop.test.ts",
  "src/components/pages/editor/MacroNodeExtension.test.ts",
  "src/lib/apiClient.test.ts",
  "src/lib/pagesClient.test.ts",
];

// Never a unit test in either project: integration specs have their own
// config, and node_modules is never ours.
const ALWAYS_EXCLUDE = ["src/**/*.int.test.ts", "node_modules/**"];

// Projects are separate Vite configs — they do not inherit the root's
// `plugins`/`resolve`, so both of these are shared explicitly rather than
// declared once at the top level.
const plugins = [react()];
const resolve = { alias: { "@": path.resolve(__dirname, "src") } };

// vitest.setup.ts's shims already guard with `typeof window !== "undefined"`,
// so it's safe to load for both projects. The DATABASE_URL fallback at its
// top is load-bearing for node-project files too (e.g. gateway.test.ts
// transitively imports server config) — don't scope setupFiles to jsdom
// only. `setup` cost is mostly module resolution, not the DOM shims, so
// there's nothing to save by dropping it for the node project either.
const setupFiles = ["./vitest.setup.ts"];

export default defineConfig({
  test: {
    // Phase 0 found 35 of 95 web unit files need no DOM at all and were
    // paying ~600ms of jsdom construction for nothing (environment 58.7s vs
    // tests 22.5s on the reference run — see docs/testing-baseline.md). The
    // split keeps that saving: .ts files run in node, .tsx files (plus the
    // four named above) get a document.
    //
    // This was `environment: "node"` + `environmentMatchGlobs` until the
    // Vitest 4 upgrade, which *removed* environmentMatchGlobs — the old
    // config's own comment said to migrate the split to `projects` rather
    // than drop it when that upgrade happened, so that is what this is.
    // Silently deleting the split would have put every .tsx file back in
    // jsdom and given back the whole Phase 0 saving.
    projects: [
      {
        plugins,
        resolve,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...ALWAYS_EXCLUDE, ...JSDOM_TS_FILES],
          setupFiles,
        },
      },
      {
        plugins,
        resolve,
        test: {
          name: "jsdom",
          environment: "jsdom",
          environmentOptions: { jsdom: { url: BASE_URL } },
          include: ["src/**/*.test.tsx", ...JSDOM_TS_FILES],
          exclude: ALWAYS_EXCLUDE,
          setupFiles,
        },
      },
    ],
    reporters: ["dot"],
    // KI-13's confirmed mechanism is wall-clock waitFor budgets starving
    // when the machine is oversubscribed — `pnpm -r` runs packages in
    // parallel, each spawning its own worker pool. Cap this suite's own
    // pool so it doesn't compound that on a small machine.
    //
    // This was `poolOptions.threads.{maxThreads,minThreads}`. Under
    // `projects` that would be a *per-project* cap (4 each, 8 total, which
    // is not what the cap is for); root-level `maxWorkers` is the
    // pool-agnostic form and caps the run as a whole, which is the original
    // intent. There is no `minWorkers` counterpart — Vitest 4 removed it —
    // but the old `minThreads: 1` only restated the default floor, so
    // nothing is lost with it gone.
    //
    // isolate: false was measured and rejected (2026-08-23): 248 of 569
    // tests failed. The suite has real cross-file coupling — vitest.setup.ts's
    // matchMedia/ResizeObserver shims hold module-level state, MSW handlers
    // accumulate, and Radix leaves body styles behind. Making isolate: false
    // viable means auditing every module-level test global first; that's real
    // work with a real payoff, but it belongs after Phase 5 cuts the file
    // count, not here. Do not "discover" this lever again without redoing
    // the 248-failure measurement.
    maxWorkers: 4,
  },
});
