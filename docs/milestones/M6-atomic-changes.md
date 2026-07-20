# M6 — Atomic changes (+ optimistic updates)

**Status:** Done — 2026-07-20
Design spec: `docs/superpowers/specs/2026-07-19-m6-atomic-changes-optimistic-updates-design.md`
Decision record: `docs/architecture/ADR-013-optimistic-updates-and-atomic-batches.md`

## Scope

- Client/generator-declared command groups: a series of commands submitted as
  one all-or-nothing batch → one history entry, so undo/redo/revert treat it as
  a single change. Opt-in.
- Optimistic updates: a dispatched unit (single command or batch) applies to
  local trip state + history immediately, sends in the background via a
  sequential queue, and reconciles or rolls back on the server's response.
- Shared predictor via the `@tc/predict` package (re-exporting
  `packages/domain/src/predict.ts`; one decider, no drift). Server `seq`
  remains the sole ordering authority. **Deviation from the design spec:** the
  spec originally called for a curated `@tc/domain/predict` subpath opened
  through the UI/domain lint wall via an ESLint negation glob; that approach
  was tried and confirmed non-functional in this repo's ESLint 9 setup, so the
  plan's own documented fallback shipped instead — a standalone `@tc/predict`
  package, with the lint wall itself left untouched (see ADR-013).
- ADR-013 records the decisions (amends ADR-012 invariant 1).

## Exit gate

- [x] A batch of ≥2 commands appends exactly one history entry; undo/redo/revert
      treat it as a single change (integration test).
- [x] A partially-invalid batch appends nothing (all-or-nothing; integration test).
- [x] An optimistic edit renders before the network settles; a forced server
      failure rolls the edit (and anything queued behind it) back and surfaces an
      error (component + e2e tests).
- [x] Predictor parity: for each command type, `predictCommand` yields the same
      `TripDetail` the server produces after real execution.
- [x] `hydrate`/`project` round-trip property test green.
- [x] Projection rebuild-equals-stored golden test still green.
- [x] Lint wall: UI may import `@tc/predict` (not a `@tc/domain` subpath); bare
      `@tc/domain` and every other subpath still rejected, unchanged.
- [x] `pnpm check`, `pnpm --filter web test:int`, and the M0–M6 e2e scripts green.
- [x] ADR-013 committed; contracts CHANGELOG updated.

## Retro

**What we learned:**
- The risk gate worked as designed: Task 4's `hydrate`/`tripDetailFromState`
  round-trip property test was built and validated *before* any client code
  depended on it, and it passed cleanly — `TripDetail` is genuinely a lossless
  superset of `TripState`. No fallback (shipping `TripState` over the wire) was
  needed.
- The design spec's "Option B" (curated `@tc/domain/predict` subpath opened via
  a lint-wall exception) did not survive contact with this repo's actual
  ESLint 9 `no-restricted-imports` implementation: the negation-glob syntax the
  spec assumed (`["@tc/domain", "@tc/domain/*", "!@tc/domain/predict"]`) is
  simply not honored here. Escalated to Mitchell per the plan's own
  instructions; approved the plan's pre-documented fallback (a standalone
  `@tc/predict` package). Net effect is arguably a cleaner wall than originally
  planned — the ESLint rule needed zero changes, since `@tc/predict` is a
  different bare specifier the existing rule never matches.
- Across nearly every task, the plan's literal file paths and helper names
  (test file locations, integration-test helper names like `createTripForTest`/
  `TEST_USER`, the `Queryable` type export) were stale relative to the actual
  current codebase. Subagents were instructed to read real source before
  transcribing brief code, and every deviation was caught and corrected during
  implementation or task review — no drift shipped silently.
- Found and logged one pre-existing, unrelated e2e flake
  (`e2e/m2-history.spec.ts`, `docs/known-issues.md` KI-5) during Task 13's e2e
  work — a reload-races-an-in-flight-request pattern, same class fixed
  defensively in the new `m6-optimistic.spec.ts`. Confirmed independent of M6
  (reproduces with the new spec removed from disk) and left unfixed as
  out-of-scope; not a gate blocker since the milestone's own e2e tests are
  reliably green under `--workers=1` and the flake is pre-existing.
- `pnpm --filter web test:e2e`'s default parallel-worker run is flaky due to
  KI-1 (pre-existing `diffTripStates` property-test flake, unrelated to this
  file) and KI-5 above; both are confirmed pre-existing and unrelated to M6's
  changes, and the full suite is consistently green under
  `pnpm --filter web exec playwright test --workers=1`.
