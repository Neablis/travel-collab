### KI-1 — `diffTripStates` ignored day ORDER, so a revert could silently redate the trip — RESOLVED
- **Severity:** correctness (was logged as "reliability, possibly correctness — unconfirmed" for 14 days; it was correctness)
- **Area:** `packages/domain/src/trip/diff.ts` (step 3, day reconciliation)
- **What it actually was:** the M2 round-trip property test failed ~1-in-5 runs
  from 2026-07-12. The open question on this entry was whether the invariant was
  violated or the generator was producing states it was never meant to cover.
  **It was the code.** Shrinking the counterexample gives six operations: add day
  B, add day A, remove B, re-add B. B is appended, so an earlier state holds
  `[B, A]` while the later one holds `[A, B]` — the *same set* of dayIds in a
  different order.
- **Root cause:** step 3 rebuilt day order only when a target day was *missing*
  from current (`firstMissing !== -1`), resting on its own comment's claim that
  "both states' day lists preserve the stream's original append order". Removing
  and re-adding a day breaks that claim. With nothing missing, the diff emitted
  **no day events at all**, so `RevertToState`/undo/redo produced the wrong day
  sequence — and a day's ordinal *is* its array position, so wrong order silently
  redates every activity after it.
- **Fix (2026-07-27):** compare survivors against the target position by
  position and rebuild from the first index where they disagree. One rule covers
  both missing-day and order-only divergence, and minimality is preserved (an
  append-only difference still emits just the `DayAdded`; identical lists still
  emit nothing). Pinned by three deterministic regression tests in
  `diff.property.test.ts` ("diffTripStates day ordering (KI-1 regression)").
- **Reachability while it was open:** latent, never active. The UI mints
  `crypto.randomUUID()` per `AddDay` and the AI resolver mints ids server-side,
  so no code path re-added a dayId. It would have stopped being latent at M13
  (concurrent replay) and M11 (fork-with-lineage, where preserving day ids across
  a clone is the obvious implementation).
- **Lesson worth keeping:** a property test found a genuine correctness bug in
  the most-trusted subsystem and it was filed as possible flake for two weeks.
  Seven runs and reading the shrunk counterexample was all it took. **A
  `fast-check` failure that reproduces from its own seed is a bug report, not
  noise** — see KI-13 for why a genuinely flaky suite makes that mistake easy.
- **First noted:** 2026-07-12 (M5 Wave-2 integration). **Resolved:** 2026-07-27.
