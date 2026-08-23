import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { BASE_URL } from "./src/config";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    // Phase 0 found 35 of 95 web unit files need no DOM at all and were
    // paying ~600ms of jsdom construction for nothing (environment 58.7s vs
    // tests 22.5s on the reference run — see docs/testing-baseline.md).
    // Default to node; environmentMatchGlobs opts the DOM-touching files
    // back into jsdom. environmentMatchGlobs is deprecated in Vitest 3 in
    // favour of `projects` — this is Vitest 2.1.9, migrate the split rather
    // than dropping it when that upgrade happens.
    environment: "node",
    environmentMatchGlobs: [
      ["src/**/*.test.tsx", "jsdom"],
      // Four .ts files that need a document despite not rendering React —
      // see docs/plans/test-overhaul/phase-0-baseline.md Task 0.2 and
      // scripts/classify-test-envs.mjs for why each one does. Don't "clean
      // these up" without re-running that classifier.
      ["src/components/board/resolveDrop.test.ts", "jsdom"],
      ["src/components/pages/editor/MacroNodeExtension.test.ts", "jsdom"],
      ["src/lib/apiClient.test.ts", "jsdom"],
      ["src/lib/pagesClient.test.ts", "jsdom"],
    ],
    environmentOptions: { jsdom: { url: BASE_URL } },
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/**/*.int.test.ts", "node_modules/**"],
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
    // isolate: false was measured and rejected (2026-08-23): 248 of 569
    // tests failed. The suite has real cross-file coupling — vitest.setup.ts's
    // matchMedia/ResizeObserver shims hold module-level state, MSW handlers
    // accumulate, and Radix leaves body styles behind. Making isolate: false
    // viable means auditing every module-level test global first; that's real
    // work with a real payoff, but it belongs after Phase 5 cuts the file
    // count, not here. Do not "discover" this lever again without redoing
    // the 248-failure measurement.
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
  },
});
