# ADR-006: Conflict evaluation via an injected context

**Status:** Accepted — 2026-07-09
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

M3 adds date-anchored activities whose constraints become soft conflicts when
a trip's dates move (foundation §4). Three of the four anchor kinds —
`dayOfWeek`, `dateRange`, `timeOfDay` — are computable from `TripState` alone.
The fourth, `publicHoliday`, is not: deciding whether a derived date is a
public holiday in some country needs a holiday calendar the engine cannot
produce. A later, related need is the same shape — time-zone-aware rules
(cross-zone travel feasibility, DST-correct reasoning) will need a zone the
pure engine must not read from the wall clock.

This collides with **Invariant 4**: `packages/domain` performs no I/O — no
database, no HTTP, no wall-clock reads; time is *passed in*. The conflict
engine (`detectConflicts(state)`) is a pure function today, and its output is a
stored projection guarded by the golden rebuild test — so its result must be a
deterministic function of its inputs.

Options weighed for supplying external/temporal facts to the engine:

- **A. Injected context.** `detectConflicts(state, ctx)` where `ctx` carries
  the facts the engine can't compute (a holiday oracle, a timezone). The
  server builds `ctx` and passes it in — the exact precedent already set for
  time. Domain stays pure; determinism holds as long as `ctx` is deterministic
  at evaluation/rebuild time.
- **B. Bundle a holiday dataset into the domain.** The engine imports a
  holiday library/dataset directly. Breaks "depends only on contracts,"
  freezes a data dependency into the pure core, and makes the golden test
  sensitive to dataset updates (a library bump can change stored conflicts).
- **C. Fetch inside the engine.** Directly violates Invariant 4; not
  considered beyond naming it.

## Decision

**Option A — an injected `ConflictContext`.** The conflict engine signature
becomes `detectConflicts(state, ctx)` (and each rule `(state, ctx) => Conflict[]`).
`ctx` exposes exactly two things in M3:

- `isPublicHoliday(countryCode, isoDate): boolean` — the holiday oracle. M3
  injects a **permissive stub `() => true`** so `publicHoliday` anchors are
  always satisfied (never a conflict). The rule genuinely calls the oracle, so
  wiring an offline library (`date-holidays`) later is a one-line swap in
  `src/server` with no rule or signature change.
- `timezone: string` — hard-coded `"America/Los_Angeles"` in M3, plumbed but
  read by no rule yet. It reserves the seam so the first time-aware rule does
  not reshape the signature again.

`ctx` is constructed in `apps/web/src/server` and passed into every
`detectConflicts` call site. It is a read-only bag of facts, never a service
the domain calls out to.

## Consequences

- The domain stays pure: it *receives* holiday/zone facts, never fetches them —
  Invariant 4 intact, the golden rebuild test still meaningful (the M3 stub is
  deterministic; a future live holiday source must be deterministic-at-rebuild,
  i.e. an offline dataset, not a network call — recorded here as a constraint).
- The `publicHoliday` anchor kind can ship its data shape in M3 with zero
  behavioral risk: it is inert, but the seam that will animate it is real and
  exercised by tests.
- One-line provider/zone swaps later touch only `src/server` wiring; callers
  and rules are unaffected — the same swappability the `AccessPolicy` and
  `Geocoder` seams give elsewhere.
- Every rule now takes `ctx` even when it ignores it (uniform signature). Minor
  boilerplate, paid once.
- This is the general mechanism for "the conflict engine needs a fact it can't
  compute": future such facts are added to `ConflictContext`, not smuggled into
  `TripState` or fetched inline.

## Amendment — 2026-08-07

`timezone: string` is removed from `ConflictContext`, `DEFAULT_CONFLICT_CONTEXT`,
and `serverConflictContext()`; `TRIP_TIMEZONE` is dropped from
`apps/web/src/server/config.ts` (M8 Wave B, Task B2).

It reserved the seam described above, but no rule ever read it — confirmed by
grep across `packages/` and `apps/web/src` before removal — and M8's Wave A
review (`docs/known-issues.md` § "Dormant by decision," D-1) flagged it as dead
weight to clear alongside the anchors-UI retirement. Unlike `publicHoliday`,
which is a permissive stub genuinely called by the `anchorRule`, `timezone` was
plumbed and never wired to a call site at all.

The **decision stands**: an injected `ConflictContext` is still the right shape
for facts the pure engine can't compute, and the pattern established here
(oracle in, no I/O in the domain) is unchanged. Only the speculative `timezone`
field is retired — it was added ahead of a consumer, not in response to one.
When a real time-zone-aware rule (cross-zone travel feasibility, DST-correct
reasoning) is built, it should add `timezone` (or whatever shape that rule
actually needs) back to `ConflictContext` deliberately, scoped to what the rule
reads — not inherit this removed field as if it were still live.
