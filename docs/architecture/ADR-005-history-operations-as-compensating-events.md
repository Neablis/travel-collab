# ADR-005: History operations as compensating events with envelope provenance

**Status:** Accepted — 2026-07-08
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

M2 delivers undo, redo, and revert-to-state (ADR-003 scoped these to the
planning domain). The open question was how "go back" coexists with
Invariant 1 — the append-only event log as the sole source of truth. Three
mechanisms were weighed:

- **A. Compensating events.** Undo/redo/revert are ordinary commands whose
  decide step emits ordinary domain events computed as a state diff
  (`diffTripStates(current, target)`). History only ever moves forward —
  the git-revert model.
- **B. Marker/snapshot event.** A single `TripReverted` event per revert.
  The `{toSeq}` variant breaks the pure per-event fold (`evolveTrip` cannot
  reconstruct seq-N state without re-reading earlier events), changing the
  reducer signature and every replay path. The snapshot-payload variant
  keeps the fold pure but freezes the entire `TripState` shape into an
  immutable-forever event schema — the granularity/upcasting trap ADR-003
  already rejected for snapshot-per-change.
- **C. Movable head pointer.** Git-reset style: the log is immutable but a
  per-stream head pointer moves. Every reader — projections, rebuild,
  Phase 2 sync, fork lineage — must consult the pointer forever; the log
  alone stops being the truth. Weakens Invariant 1, which M2 exists to
  prove.

A secondary question: how to record *provenance* (grouping one command's
events into one history entry; marking batches as undo/redo/revert so the
undo/redo stack is derivable). Options: metadata on the event envelope, or
no-op marker events inside the log.

## Decision

**Mechanism A with envelope provenance.** Undo/redo/revert append ordinary
domain events produced by a pure state-diff function; no special event
types, no reducer changes, no head pointer. `EventEnvelope` (and the
`events` table) gain `batchId` (one per command execution) and `origin`
(`user | undo | redo | revert`, with target references); existing events
backfill as single-event `user` batches. Provenance describes how a change
came to be, not what it changed — it belongs beside `actor_id` and
`occurred_at`, keeping the domain event vocabulary purely domain.

## Consequences

- Replay, projections, the golden rebuild test, and the conflict engine are
  untouched: a revert is indistinguishable from ordinary edits at the state
  level, distinguished only by envelope metadata.
- The log is truly append-only forever; "undo" adds history rather than
  erasing it, which is what makes concurrent-edit semantics (Phase 2) and
  fork lineage (M7) remain tractable.
- Correctness concentrates in one pure function, `diffTripStates`, with a
  crisp property-test invariant: applying the diff always reproduces the
  target state.
- Every planning event type must remain diffable: state-affecting fields
  need events capable of expressing their reversal (this forced
  `ConflictUndismissed` to exist alongside `ConflictDismissed`).
- The envelope contract change is a one-time migration + backfill and a
  contracts changelog entry; Phase 2's activity feed and concurrent-edit
  work inherit correlation ids for free.
- Compensating batches can be verbose for large reverts; acceptable because
  history renders batches, not raw events, and Phase 1 trips are small.
