# Phase 1 — Config-only speed and reliability wins

**The whole phase changes no test content.** Every task here is a config edit
that is independently revertable. This is deliberate: it banks a measurable
speedup before any of the riskier work starts, and if a later phase has to be
rolled back, these wins survive.

**Measured outcome of Task 1.1 alone: 43.1s → 35.2s wall, `environment` 58.7s
→ 36.6s.** Proven on this tree 2026-08-23 with a throwaway config.

---

## Task 1.1 — Split the unit suite by environment

`apps/web/vitest.unit.config.ts` currently gives all 95 files a jsdom world.
Phase 0 established 35 need only node.

```ts
// apps/web/vitest.unit.config.ts
test: {
  environment: "node",
  environmentMatchGlobs: [
    ["src/**/*.test.tsx", "jsdom"],
    // The four .ts files that need a document despite not rendering React.
    // Phase 0 Task 0.2 records why each one does; do not "clean these up"
    // without re-running that check.
    ["src/components/board/resolveDrop.test.ts", "jsdom"],
    ["src/components/pages/editor/MacroNodeExtension.test.ts", "jsdom"],
    ["src/lib/apiClient.test.ts", "jsdom"],
    ["src/lib/pagesClient.test.ts", "jsdom"],
  ],
  environmentOptions: { jsdom: { url: BASE_URL } },
  // ...unchanged
}
```

`environmentMatchGlobs` is present in the installed Vitest (2.1.9 — verified).
It is deprecated in Vitest 3 in favour of `projects`; leave a comment saying so
so a future upgrade knows what to migrate rather than deleting the split.

**`vitest.setup.ts` must stay safe under both environments.** It already guards
its shims with `typeof window !== "undefined"`, so it works as-is — but the
`process.env.DATABASE_URL ??=` line at the top is now load-bearing for more
files, and the `cleanup()` `afterEach` is a no-op in node. Add a one-line
comment at each so the next reader doesn't "simplify" them away.

**Do not** try to reduce the setup cost by dropping `setupFiles` for the node
project. `setup 10.18s` is spread across all 95 files and is mostly module
resolution, not the shims.

## Task 1.2 — Do NOT set `isolate: false`. Record why.

This is a task, not an omission, because it is the obvious next idea and it
does not work here.

**Measured 2026-08-23: `--no-isolate` produces 248 failures** out of 569. The
suite has real cross-file coupling — the `matchMedia`/`ResizeObserver` shims in
`vitest.setup.ts` hold module-level state (`mediaMatches`,
`activeResizeObservers`), MSW handlers accumulate, and Radix leaves body styles
behind (the exact leak `vitest.setup.ts`'s explicit `cleanup()` comment
describes).

Add this finding as a comment in `vitest.unit.config.ts` next to the pool
settings. The general guidance is real — [isolation is the biggest single
Vitest performance lever](https://main.vitest.dev/guide/improving-performance)
— and so is the counter-argument: [a suite that fails 1-in-20 for reasons
nobody can reproduce is not a faster
suite](https://buildpulse.io/blog/vitest-isolate-flaky-tests-ci). Making
`isolate: false` viable would mean auditing every module-level test global,
which is real work with a real payoff, but it belongs *after* Phase 5 has cut
the file count — do it then, if the numbers still justify it, not now.

## Task 1.3 — Pin worker counts against the KI-13 failure mode

KI-13's confirmed mechanism is wall-clock `waitFor` budgets starving when the
machine is oversubscribed. `pnpm -r` runs packages in parallel and each spawns
its own workers, so a 4-core machine can end up with 3 packages × 4 workers.

Set an explicit, modest ceiling in `apps/web/vitest.unit.config.ts`:

```ts
poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
```

Then **measure whether it helps or hurts** on the Phase 0 baseline and keep the
setting only if it wins. Phase 4 owns the real KI-13 fix; this is a cheap
mitigation to try first, and if it does nothing, say so in the commit and
revert it rather than leaving a cargo-culted number in the config.

## Task 1.4 — Harden `playwright.config.ts`

Four settings are missing, and each one is a known-issue or a debugging cost.

```ts
export default defineConfig({
  testDir: "./e2e",
  reporter: "line",
  // KI-19: the suite ran at Playwright's 1280x720 default with no viewport
  // set, which is why Wave 1's gate passed 11/11 while the page was inert
  // below 1180px. An explicit default plus a narrow project (Phase 3) is
  // what closes that blind spot.
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 900 },
    // A failing CI run should hand back a trace, not a line of text. This is
    // what turned KI-21 from "intermittent, cause unknown" into a precise
    // trace-level diagnosis; make that the default rather than something
    // someone has to remember to enable while re-running a red build.
    trace: "on-first-retry",
    video: "off",
  },
  // One retry in CI only. NOT a flake-suppression tool: a test that passes on
  // retry is reported as flaky and must be treated as a bug (see Phase 4).
  // Zero retries locally, so a local failure is always a real signal.
  retries: process.env.CI ? 1 : 0,
  // ...webServer unchanged
});
```

**`viewport: { height: 900 }` is not cosmetic.** KI-21's traced root cause is
day 2's column sitting ~8px below the 720px fold, so `dragCardTo`'s auto-scroll
poll never completes inside its budget. A taller default viewport is half of
that fix; the other half is Phase 3's drag helper rewrite.

**On `retries`:** the goal is not green builds, it is a *labelled* flaky
result. Playwright reports retried-and-passed tests distinctly. Phase 4's
standing rule is that a flaky label is a bug report — the same lesson KI-1
taught the hard way, where a real correctness bug sat behind a "probably flake"
label for two weeks.

## Task 1.5 — Re-measure and record

Re-run the Phase 0 commands three times. Update `docs/testing-baseline.md` with
a "after Phase 1" column. If the unit suite did not get meaningfully faster,
something in 1.1 did not apply — check that the node project is actually being
used (`environment` should drop by roughly a third).

---

## Exit checklist

- [ ] Unit suite `environment` time down ≥30% against the Phase 0 baseline.
- [ ] All 569 tests still pass (same count — no content changed).
- [ ] `isolate: false` finding recorded in-config with the 248-failure number.
- [ ] `playwright.config.ts` sets viewport, trace, and CI-only retries.
- [ ] Full e2e green once via `test:e2e:ci-like` — the taller viewport may
      change layout-sensitive assertions, and that must be caught here, not in
      Phase 3.
- [ ] `docs/testing-baseline.md` updated with after-numbers.
