# M6 Design — Atomic Changes + Optimistic Updates

**Date:** 2026-07-19
**Milestone:** M6 (Atomic changes)
**Status:** Approved design — implementation plan pending
**Deciders:** Mitchell (product/eng), Claude (architect)
**ADR to write during implementation:** ADR-013

## Summary

M6 ships two features that turn out to share one mechanism:

1. **Atomic batches** (M6's defined scope): a client or generator declares an
   ordered list of commands submitted as **one all-or-nothing batch → one
   history entry**, so undo/redo/revert treat it as a single change.
2. **Optimistic updates** (added to this milestone): the unit of dispatch —
   single command or batch — is **applied to local trip state and local history
   immediately**, sent to the server in the background, and **reconciled or
   rolled back** when the server answers.

They compose because a batch is exactly the unit you optimistically apply and
roll back as a whole. One command is a batch of one. The milestone therefore has
a single dispatch primitive: `dispatch(command | batch)`.

This design consciously **amends ADR-012 invariant 1** ("TripProvider is a
server-cache + dispatch, never a store … Trip state is mutated ONLY by
dispatch(command) → refetch. No direct context writes."). TripProvider gains a
client-side optimistic overlay. It remains *not* a second source of truth:
confirmed state stays server-authoritative; the overlay is a disposable
prediction that is always superseded by the server's response.

## Current state (what we are replacing)

Today's flow, codified in ADR-012 and implemented in
`apps/web/src/components/trip/context/TripProvider.tsx`:

```
dispatch(command) → POST /api/trips/:id/commands → load()  // refetch BOTH detail + history
```

`sendTripCommand` returns `ApiResult<null>` — the command endpoint returns
nothing useful, so the client must refetch to learn the outcome. The domain
already contains the full pure chain we need to predict outcomes locally:

- `decideTripCommand(state, command, ctx) → Decision` (events | rejection),
  `packages/domain/src/trip/decide.ts` — an **exhaustive `switch (command.type)`**.
- `evolveTrip(state, event) → state`, `packages/domain/src/trip/evolve.ts`.
- `tripDetailFromState` / `projectTripDetails`, `packages/domain/src/trip/detail.ts`.
- History-entry construction and the pure conflict engine
  (`packages/domain/src/trip/{history,conflicts}.ts`).

This chain is already pure (Invariant 4 — no I/O) and depends only on
`@tc/contracts`. The only thing keeping the UI out of it is the CI lint wall
(`AGENTS.md`: "UI … MUST NOT import packages/domain"), which is a policy
boundary, not a technical dependency.

## Key decisions

Decisions locked during brainstorming, most-consequential first:

1. **Shared predictor, one implementation, no drift.** The client predicts a
   command's outcome by reusing the *same* domain functions the server runs —
   never a parallel reimplementation. The existing exhaustive `switch` in
   `decideTripCommand` is the compile-time guarantee: you cannot add a command
   without handling it, and there is no second copy to drift from.

2. **Exposure: a curated `@tc/domain/predict` entrypoint (Option B).** Rather
   than re-homing the pure core into a new package, add a narrow
   `@tc/domain/predict` subpath exporting only `predictCommand` / `predictBatch`.
   The lint wall changes from "UI may not import `@tc/domain`" to "UI may not
   import `@tc/domain/*` **except** `@tc/domain/predict`." Less code movement;
   the exception is a single, auditable subpath.

3. **Sequential queue; server `seq` is the sole ordering authority.** Rapid
   edits apply optimistically and immediately but are sent one at a time, in
   order, each predicted on top of the last. No client timestamps, no
   client-driven reordering (YAGNI, and see "Rejected alternatives").

4. **Client stays in `TripDetail`-space.** `TripDetail` is a superset of
   `TripState` (same core fields plus derived extras). The predictor bridges
   `TripDetail → TripState → decide → evolve → project → TripDetail` internally,
   so the client never has to hold or parse the domain-internal `TripState`.

## Architecture

### Data flow (replaces `POST → refetch`)

```
dispatch(unit):                       # unit = one command or a batch
  1. predict(unit) on current derived detail
       → { detail', entry }  |  { rejected }
  2. if rejected: surface error, do NOT send        (instant, no round-trip)
  3. else apply to optimistic overlay               (instant re-render, entry marked "pending")
  4. enqueue send (sequential, one in flight, in order)
  5. server responds:
       ok    → adopt authoritative { detail, history } from the response,
               drop this unit's overlay entry (real seq now present),
               re-predict any still-pending units on the new confirmed base
       error → roll back this unit AND everything queued behind it,
               restore confirmed state, surface the error
```

### Client state machine (`TripProvider`)

TripProvider stops being a pure server-cache and holds three things:

- **Confirmed state** — the last server-authoritative `{ detail, history }`.
  Mutated only by a server response.
- **Optimistic overlay** — an ordered list of pending units, each
  `{ id, unit, predictedDetail, provisionalEntry }`.
- **Derived active view** — `activeTrip` / `activeHistory` = confirmed state with
  the overlay folded on top. This is what every surface renders.

Rules:

- One send in flight at a time; the queue preserves user/causal order (which,
  for a single user, equals wall-clock order anyway).
- On a successful response, replace confirmed state wholesale with the
  authoritative payload, then recompute the overlay by re-predicting the
  remaining pending units on the new base.
- On an error response, roll back the failing unit and all units queued behind
  it (they were predicted on a state that will never exist), restore confirmed
  state, and surface the error.
- The existing `no-op` code stays benign (no error, and now no refetch either).
- Preview / time-travel (`enter`/`exit`) is disabled while any unit is pending —
  you cannot branch history from a state the server has not confirmed.
- `pending` remains exposed for buttons and spinners.

### The predictor: `@tc/domain/predict`

```ts
predictCommand(detail: TripDetail, command: BoardCommand):
  | { ok: true; detail: TripDetail; entry: HistoryEntry }
  | { ok: false; rejection: Rejection };

predictBatch(detail: TripDetail, commands: BoardCommand[]):
  | { ok: true; detail: TripDetail; entry: HistoryEntry }   // folded, all-or-nothing
  | { ok: false; rejection: Rejection };
```

Internally: `hydrate(detail) → state`, then the exact existing
`decide → evolve → project` chain, then `tripDetailFromState` for the next
detail and history-entry construction for the provisional entry. `predictBatch`
folds the commands over one hydrated state; if any command rejects, the whole
batch rejects and nothing is applied.

`hydrate: TripDetail → TripState` is the only new mapping. It is guarded by a
fast-check **round-trip property test**: `hydrate(tripDetailFromState(state))`
deep-equals `state` for arbitrary states. That makes `hydrate` provably the
inverse of the projection, so it cannot drift from it.

### Server: batch execution (M6 core scope)

New `executeTripCommandBatch(commands, actorId)` alongside the existing
`executeTripCommand`:

- Load state once; `decide` each command in order against the evolving state.
- Any rejection → append nothing; return the rejection (`400` invalid,
  `409` concurrency), matching today's single-command error contract.
- On success, append all resulting events under **one history entry**
  (a batch id groups them), then update projections as usual.

Undo/revert already operate per history entry (ADR-005), so representing a batch
as a single entry is a grouping concern at append time plus history-entry
construction — not a change to undo/revert semantics.

### Contract changes (`packages/contracts`; CHANGELOG entry required)

Per Invariant 5, these are protocol changes with a `docs/contracts/CHANGELOG.md`
entry and all consumers updated in the same PR:

- **Batch DTO** — a batch command shape, e.g.
  `{ type: "Batch", tripId, commands: BoardCommand[] }`, or a dedicated
  `/api/trips/:id/commands/batch` body carrying `commands: BoardCommand[]`.
- **Command endpoints return the authoritative result** — `POST /commands` and
  the batch endpoint return `{ detail: TripDetail, history: TripHistory }` (or at
  minimum the new history entry plus enough to reconcile). This is the change
  that makes optimism cheap: the client reconciles from the response instead of
  issuing a second refetch.

## Testing and Definition of Done

- **Predictor parity** — for a representative command of *each* type,
  `predictCommand` produces the same `TripDetail` the server produces after real
  execution. Compile-time forces the predictor entry to exist; this test forces
  it to be correct.
- **Round-trip** — `hydrate(project(state)) === state` property test (fast-check).
- **Rollback** — a forced server error rolls back the failing unit and every unit
  queued behind it; the optimistic entry disappears and confirmed state is
  restored.
- **Batch atomicity** — a partially invalid batch appends nothing; a valid batch
  produces exactly one history entry; the projection rebuild-equals-stored golden
  test stays green.
- **Instant render** — an edit renders before the network settles (assert
  optimistic apply precedes the response).
- **E2E** — extend the M6 milestone script with an optimistic edit and a
  forced-failure revert.
- Standard DoD from `AGENTS.md`: typecheck, lint (including the updated wall
  rule), unit + contract + integration tests, docs updated.

## ADR-013 (to write during implementation)

Record: the amendment of ADR-012 invariant 1 (optimistic overlay in
TripProvider, confirmed state still server-authoritative); the
`@tc/domain/predict` wall exception; the sequential-queue + `seq`-as-truth
ordering decision; and the batch-as-one-history-entry model.

## Preflight (M6 kickoff bookkeeping)

- Fix `Current milestone` → **M6** in `docs/milestones/README.md` (the M5
  gate-close left it at M5; standing preflight task catches this).
- Write the M6 milestone file `docs/milestones/M6-atomic-changes.md` (scope +
  exit gate) before the first implementation commit.

## Primary risk to validate first

The `hydrate` round-trip must actually hold. If the projection turns out to be
lossy in some corner — a `TripState` distinction that `TripDetail` flattens —
the predictor cannot live purely in `TripDetail`-space. Fallback: promote
`TripState` (or a lossless mirror) to a `@tc/contracts` schema and ship it in the
detail response, so the client folds from authoritative state. Validate the
round-trip property test **before** building the client overlay on top of it.

## Rejected alternatives

- **Two implementations kept in parity** (a client predictor separate from the
  server decider): rejected — drift risk is exactly what Mitchell wants to avoid.
  One decider, reused, is stronger than any parity test.
- **New `@tc/predict` package (Option A)**: viable and keeps the wall a perfect
  bright line, but more refactoring of a heavily-tested core than the curated
  entrypoint warrants right now.
- **Client-timestamp reordering of history**: rejected. It turns an append-only
  log into insert-anywhere (invalidating projections built on later events and
  the compensating-event basis of undo/revert per ADR-005), relies on untrusted,
  non-monotonic client clocks, and is hostile to Phase 2 where clocks disagree
  across actors (Invariant 6). Wall-clock is not "how the user used the app" —
  causal order is, and the sequential queue already preserves it. If intent-time
  display is ever wanted, carry a client timestamp as **non-ordering** event
  metadata; deferred as YAGNI.
- **UI-local optimism only** (move the card visually, refetch history as today):
  rejected — does not satisfy the "update frontend history first" goal.
- **Fire-and-forget parallel sends**: rejected — out-of-order reconciliation
  against optimistic concurrency is error-prone and needless for single-player.
