import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { BASE_URL, WEB_PORT } from "./src/config";

// Vitest assigns Vite's resolved `env` onto `process.env` — and Vite's `env`
// carries its own `BASE_URL`, the app's public base path, "/". With `projects`
// this config file is evaluated once per project, and every load after the
// first therefore reads `process.env.BASE_URL === "/"` through src/config.ts,
// which `new JSDOM({ url })` rejects with "Invalid URL: /". Only an absolute
// URL can have come from a real BASE_URL override, so fall back to the same
// localhost:WEB_PORT src/config.ts would have computed unpolluted. (The
// pollution predates this config: workers already saw BASE_URL === "/" under
// environmentMatchGlobs — it just had nowhere to surface.)
const JSDOM_URL = /^https?:\/\//.test(BASE_URL) ? BASE_URL : `http://localhost:${WEB_PORT}`;

// Four .ts files that need a document despite not rendering React — see
// docs/plans/test-overhaul/phase-0-baseline.md Task 0.2 and
// scripts/classify-test-envs.mjs for why each one does. Don't "clean these up"
// without re-running that classifier. They are the one place the two projects
// below overlap, so they are named once and subtracted from the node project
// rather than listed twice by hand.
const DOM_TS_TESTS = [
  "src/components/board/resolveDrop.test.ts",
  "src/components/pages/editor/MacroNodeExtension.test.ts",
  "src/lib/apiClient.test.ts",
  "src/lib/pagesClient.test.ts",
];

// *.int.test.ts is `vitest.config.ts`'s suite (real Postgres); it matches
// `src/**/*.test.ts` too, so both projects have to exclude it explicitly.
const NEVER = ["src/**/*.int.test.ts", "node_modules/**"];

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    // Phase 0 found 35 of 95 web unit files need no DOM at all and were paying
    // ~600ms of jsdom construction for nothing (environment 58.7s vs tests
    // 22.5s on the reference run — see docs/testing-baseline.md). The split is
    // still earning its keep: re-measured 2026-08-28 on 122 files / 1143
    // tests, forcing every file to jsdom costs environment 99.8s / 80.4s wall
    // against 51.5s / 55.9s with the split.
    //
    // The split used to be `environment: "node"` plus `environmentMatchGlobs`.
    // That option is deprecated in Vitest 3 (which this tree is on) and
    // *removed* in Vitest 4, where it would fail silently open — every file
    // back on the default environment, the win gone, nothing red. Two
    // `projects` express the same partition in the supported form: the two
    // includes are disjoint and together cover exactly what the old single
    // `include: ["src/**/*.test.{ts,tsx}"]` collected.
    //
    // `extends: true` is load-bearing: a project inherits nothing from the
    // root `test` block without it, so setupFiles/environmentOptions would
    // silently vanish. Root-only options (reporters, poolOptions.threads —
    // see NonProjectOptions in Vitest's types) stay below, where the pool
    // actually reads them.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...NEVER, ...DOM_TS_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", ...DOM_TS_TESTS],
          exclude: NEVER,
        },
      },
    ],
    environmentOptions: { jsdom: { url: JSDOM_URL } },
    // vitest.setup.ts's shims already guard with `typeof window !== "undefined"`,
    // so it's safe to load for both projects. The DATABASE_URL fallback at
    // its top is load-bearing for node-project files too (e.g. gateway.test.ts
    // transitively imports server config) — don't scope setupFiles to jsdom
    // only. `setup` cost is mostly module resolution, not the DOM shims, so
    // there's nothing to save by dropping it for the node project either.
    setupFiles: ["./vitest.setup.ts"],
    reporters: ["dot"],
    // KI-13's confirmed mechanism is wall-clock waitFor budgets starving
    // when the machine is oversubscribed — `pnpm -r` runs packages in
    // parallel, each spawning its own worker pool. Cap this suite's own
    // pool so it doesn't compound that on a small machine.
    //
    // isolate: false was measured and rejected (2026-08-23: 248 of 569 tests
    // failed) and re-measured after the 2→3 bump on a suite that has since
    // grown (2026-08-28, `--no-isolate`: 487 of 1144 tests, 67 of 123 files).
    // The suite has real cross-file coupling — vitest.setup.ts's
    // matchMedia/ResizeObserver shims hold module-level state, MSW handlers
    // accumulate, and Radix leaves body styles behind. Making isolate: false
    // viable means auditing every module-level test global first; that's real
    // work with a real payoff, but it belongs after the Phase 5 prune cuts the
    // file count, not here. Do not "discover" this lever again without redoing
    // the measurement.
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
  },
});
