# Test suite overhaul — Implementation Plan (index)

> **Execute one phase file at a time, in order.** Each is self-contained.
> Phases 0–4 are safety-and-speed work that changes almost no test *content*;
> Phases 5–6 change content and must not start until 0–4 have landed.

**Goal:** turn the test suite from a drag into a fast, trustworthy signal —
fewer tests, each worth more; no flakes; and a red run that means a regression.

**Non-goal:** raising coverage. This plan expects total test count to **fall**
and confidence to **rise**. If a phase ends with more tests than it started
with, it did the wrong thing.

---

## The evidence (measured 2026-08-23, this branch, 4-core sandbox)

Everything below is a real measurement on this tree, not an estimate. Re-run
the commands in `test-overhaul/phase-0-baseline.md` before trusting them on
other hardware — KI-13 says single runs lie, so Phase 0 re-measures properly.

| Fact | Number | Source |
|---|---|---|
| `apps/web` unit suite | 95 files, 569 tests, **43.1s** wall | `vitest run -c vitest.unit.config.ts` |
| … of which jsdom construction | **`environment 58.7s`** | same run's footer |
| … of which actually running assertions | `tests 22.5s` | same run's footer |
| `packages/domain` suite | 22 files, 129 tests, **2.6s** (`environment 4ms`) | `pnpm --filter @tc/domain test` |
| Web unit files needing **no** DOM | **35 of 95** | Phase 0's classifier |
| Env-split probe (node for those 35) | **43.1s → 35.2s**, `environment 58.7s → 36.6s` | measured with a throwaway `environmentMatchGlobs` config |
| `--no-isolate` probe | **248 failures** | measured; the suite has real cross-file coupling |
| `apps/web` test LOC vs source LOC | **11,341 vs 13,369 (85%)** | `find src -name '*.test.*'` |
| Repo-wide test cases | **864** `it(`/`test(` | grep |
| e2e | 11 specs, **15 tests**, 1,240 LOC | `e2e/` |
| e2e sign-ins through the real UI form | **24 calls** to `signInAsDevUser` | grep |
| e2e locator mix | getByRole **182** / getByText **65** / getByTestId **61** / raw `.locator()` **4** | grep |

**The three findings that shape this plan:**

1. **The unit suite spends 2.6× more time building DOMs than running
   assertions.** `environment` (58.7s) dwarfs `tests` (22.5s). The suite is not
   slow because the tests are slow; it is slow because there are 95 jsdom
   worlds. Two levers act on that: stop building a DOM where none is needed
   (Phase 1, measured −18% wall for a 3-line config change), and **have fewer
   files** (Phase 5). Nothing else moves this number meaningfully.
2. **`--no-isolate` is off the table**, and we now know that empirically rather
   than by reputation: 248 failures. The suite has genuine cross-file state
   coupling (jsdom globals, `matchMedia`/`ResizeObserver` shims, MSW handlers).
   Do not let a future session "discover" this lever and burn an afternoon.
3. **The e2e layer is in better shape than the unit layer.** It is already
   role-first (182 `getByRole` vs 4 raw CSS locators), already waits on real
   responses instead of sleeping, and is only 15 tests. Its problems are
   mechanical (sign-in cost, one viewport, one drag helper) — not a rewrite.
   The unit layer is where the bloat and the brittleness are.

---

## Known issues this plan closes

| KI | What it is | Closed by |
|---|---|---|
| **KI-13** | `pnpm check` jsdom tests time out under load; different random subset each run | Phase 4 |
| **KI-19** | e2e runs at exactly one viewport, so responsive bugs are invisible to the gate | Phase 3 |
| **KI-21** | `m1-board` / `m4-money-and-lenses` fail inside `dragCardTo`; trace-level cause known | Phase 3 |
| **KI-25** | the simulated-AI guarantee depends on how the dev server was started | Phase 3 |

**KI-11 (no test ever calls a real model) is deliberately NOT closed here.**
It is not a flake or a bloat problem — it is a missing capability, and its fix
(a non-CI model harness) is already scoped in `TODO.md` and M9. Phase 7 gives
it a documented home so the next session doesn't re-derive the argument.

---

## Principles (these are the acceptance criteria for Phases 5–7)

1. **A test earns its place by the regression it would catch.** If you cannot
   name a plausible code change that breaks this test and no other, delete it.
2. **Test the contract at its own layer, once.** A rule proven in
   `packages/domain` does not get re-proven through a rendered component. A
   schema proven in `packages/contracts` does not get re-proven in a handler.
3. **One real flow beats ten shallow renders.** Prefer a single test that
   drives a component through a user-visible sequence over ten that assert one
   prop each.
4. **Query the way a user finds things.** `getByRole(name)` first, then
   `getByLabel`, then `getByTestId` for things with no accessible identity.
   `getByText` on prose copy is the brittleness the team is complaining about.
5. **Never assert a class name.** `expect(el.className).toContain("bg-brand")`
   is a test of Tailwind, not of behavior. The design-system contract is
   enforced by the color wall lint, not by unit tests.
6. **No sleeps.** `findBy*` and web-first assertions retry; `waitForTimeout`
   and `setTimeout` do not. Every hard wait is a future flake with a delay
   on it.
7. **Data comes from a factory, never from a hand-built literal.** A literal
   that must stay internally consistent (a `costSubtotal` matching its
   activities) is a bug waiting to be committed.
8. **Speed is a correctness property.** A suite nobody trusts to run is a suite
   that stops catching things — which is exactly how KI-1 hid for two weeks.

---

## Phase files — execute in this order

| Phase | File | Delivers | Gate |
|---|---|---|---|
| 0 | `test-overhaul/phase-0-baseline.md` | Honest numbers, a file classifier, a keep/cut inventory | A committed baseline nobody has to re-derive |
| 1 | `test-overhaul/phase-1-config.md` | Environment split, pool tuning, Playwright config hardening | Unit suite measurably faster; zero test content changed |
| 2 | `test-overhaul/phase-2-factories.md` | `@tc/factories` — typed, seeded, composable scenario builders | One source of test data for unit, int, e2e and `db:seed` |
| 3 | `test-overhaul/phase-3-e2e.md` | storageState auth, API-built state, viewport projects, fixed drag | KI-19, KI-21, KI-25 closed; e2e wall time down |
| 4 | `test-overhaul/phase-4-ki13.md` | Root-cause and fix the jsdom-under-load flake | KI-13 closed; `pnpm check` trustworthy on one run |
| 5 | `test-overhaul/phase-5-prune.md` | Delete/merge redundant tests against explicit criteria | Test count down ≥35%; nothing lost that catches a real bug |
| 6 | `test-overhaul/phase-6-debrittle.md` | Rewrite survivors to the principles above | No className assertions, no prose-copy coupling, no sleeps |
| 7 | `test-overhaul/phase-7-guidelines.md` | Rewritten testing guidance + lint enforcement + a skill | A junior model writes a correct test with no frontier guidance |

**Dependencies.** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 is the safe order, and the
ordering is not arbitrary:

- **3 and 4 before 5.** You may only delete unit tests once the layer beneath
  them (e2e, integration) is a net you trust. Pruning on top of a flaky e2e
  suite is how a real regression ships.
- **2 before 5 and 6.** The factories are what make the surviving tests short
  enough to be worth keeping; rewriting tests before the factories exist means
  rewriting them twice.
- **5 before 6.** Do not de-brittle a test you are about to delete.
- **1 can be done standalone today** if someone wants an immediate win — it
  touches no test content and is independently revertable.

**Phases 5 and 6 are the only ones that can plausibly lose coverage.** Both
carry an explicit safety protocol (mutation spot-checks in 5, a
delete-and-confirm-red drill in 6). Do not skip them to save time; they are
the difference between "we deleted redundant tests" and "we deleted tests".

---

## Definition of done for the whole plan

- [ ] `pnpm test` (web unit) runs in **under 15s** on a 4-core machine.
- [ ] `pnpm check` passes **three consecutive times** with zero flakes on a
      loaded machine (KI-13's own reproduction protocol).
- [ ] Full e2e suite green **twice in a row** via `test:e2e:ci-like`, including
      a sub-1180px viewport project.
- [ ] KI-13, KI-19, KI-21, KI-25 moved to Resolved in `docs/known-issues.md`.
- [ ] Repo-wide test count down by ≥35% with no coverage regression on
      `packages/domain` (measured, not asserted).
- [ ] Zero `className` assertions, zero `waitForTimeout`, zero hand-built trip
      literals in the surviving suite (each enforced by a lint rule, not a
      convention).
- [ ] `AGENTS.md`'s Testing model and `docs/guidelines/testing.md` rewritten so
      a smaller model writes a conforming test without frontier-model guidance.
- [ ] This plan removed from `docs/plans/` per `docs/plans/README.md`, with its
      durable reasoning promoted into the guidelines and an ADR.

## Research sources

Best-practice claims in the phase files trace to these; they are cited inline
where a specific technique is prescribed.

- Playwright — [Authentication / storageState](https://playwright.dev/docs/auth),
  [Best practices 2026](https://getautonoma.com/blog/playwright-best-practices-2026),
  [Flaky test playbook 2026](https://testquality.com/playwright-flaky-tests-diagnostic-playbook-2026/),
  [Locator best practices](https://qaskills.sh/blog/playwright-best-practices-locators-2026),
  [Drag-and-drop patterns](https://scrolltest.com/playwright-drag-and-drop-testing/)
- Vitest — [Improving performance](https://main.vitest.dev/guide/improving-performance),
  [fakeTimers config](https://vitest.dev/config/faketimers),
  [isolate: speed vs. flaky tests](https://buildpulse.io/blog/vitest-isolate-flaky-tests-ci)
- Testing Library — [ByRole](https://testing-library.com/docs/queries/byrole/),
  [Common mistakes with RTL](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- Factories — [Fishery](https://github.com/thoughtbot/fishery),
  [Mock factories make better tests](https://formidable.com/blog/2023/mock-factories-make-better-tests/)
- Suite reduction — [Get rid of redundant tests](https://wsbctechnicalblog.github.io/remove-redundant-tests.html),
  [QA lead's guide to test suite bloat](https://medium.com/@aseem.bakshi/qa-leads-guide-to-cleanup-test-suite-bloat-5ca285c3551d)
