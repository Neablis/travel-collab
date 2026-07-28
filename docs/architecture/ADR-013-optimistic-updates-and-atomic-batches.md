# ADR-013: Optimistic updates + atomic command batches

**Status:** Accepted — 2026-07-19
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-07-19-M6-atomic-changes-optimistic-updates-design.md`

## Context

M6 adds atomic batches (a series of commands as one history entry) and, by
Mitchell's decision, optimistic updates: apply a dispatched change to local trip
state + history immediately, reconcile or roll back on the server's response.
ADR-012 invariant 1 held that TripProvider mutates trip state ONLY by
`dispatch → refetch`, with no direct context writes.

## Decision

1. **Optimistic overlay in TripProvider (amends ADR-012 invariant 1).**
   TripProvider holds confirmed server-authoritative state plus an ordered
   overlay of predicted pending units. The rendered view folds the overlay onto
   confirmed state. Confirmed state is still mutated only by a server response —
   the overlay is a disposable prediction, never a second source of truth.
2. **Shared predictor via `@tc/predict` (one decider, no drift).** The client
   predicts outcomes by reusing the exact server decider/reducer through a new
   package, `@tc/predict` (`packages/predict/`), which re-exports
   `packages/domain/src/predict.ts` (`export * from "@tc/domain/predict";`). UI
   code imports `@tc/predict` instead of any `@tc/domain` subpath. The
   `no-restricted-imports` lint wall in `apps/web/eslint.config.mjs` is
   untouched — it still blocks `@tc/domain`/`@tc/domain/*` exactly as it did
   before M6; `@tc/predict` is simply a different bare specifier the rule never
   matches, so the wall stays a clean, unmodified bright line. The decider's
   existing exhaustive `switch` is the compile-time guarantee that every command
   is handled; a round-trip property test guards the one new mapping
   (`hydrate`).
3. **Sequential queue; server `seq` is the sole ordering authority.** Rapid edits
   apply optimistically and immediately but send one at a time, in order. On
   failure, the failing unit and everything queued behind it roll back. No client
   timestamps; no client-driven reordering (would turn an append-only log into
   insert-anywhere and is hostile to Phase 2's multi-clock reality).
4. **A batch is one history entry.** N commands decided against the evolving
   state, appended under one `batchId`; the existing `groupBatches` /
   `buildHistoryEntries` treat it as a single change for undo/redo/revert.
5. **Command endpoints return authoritative `{ detail, history }`** so the client
   reconciles from the response instead of refetching.

## Consequences

- `@tc/predict` (re-exporting `packages/domain/src/predict.ts`), `hydrate`,
  `predictCommand`/`predictBatch`, `executeTripCommandBatch`,
  `/api/trips/:id/commands/batch`, and a reducer-backed optimistic overlay in
  TripProvider.
- Preview/time-travel is disabled while any unit is pending.
- Conflicts during the optimistic window use the default context; the server
  response is authoritative on reconcile.
- Fallback if the projection is ever lossy: ship `TripState` over the wire as a
  contract schema (the round-trip test is the tripwire).

## Deviation from the original design spec

The design spec (`docs/specs/2026-07-19-M6-atomic-changes-optimistic-updates-design.md`)
originally proposed opening the UI/domain lint wall for a curated
`@tc/domain/predict` subpath only, via an ESLint `no-restricted-imports`
negation glob (`!@tc/domain/predict` re-inclusion alongside the `@tc/domain/*`
block). During implementation (Task 6), that approach was tried and confirmed
non-functional, twice independently: this repo's ESLint 9 flat-config setup
does not honor `!`-negation re-inclusion inside `no-restricted-imports`
`group` patterns, so there was no way to carve out a single subpath while
leaving the rest of `@tc/domain` blocked. Mitchell approved the plan's own
pre-documented fallback instead — the standalone `@tc/predict` package
described in Decision point 2 above. The lint wall itself was never edited;
`@tc/predict` sidesteps it by not matching the blocked specifiers at all. The
design spec has not been retroactively edited to reflect this; this ADR is the
authoritative record of what actually shipped.
