# ADR-016: Trip soft delete as a domain event

**Status:** Accepted — 2026-07-28
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-07-28-M8-make-it-real-design.md`

## Context

M8 gives a trip a lifecycle: it can be renamed, dated, deleted, restored, and
duplicated. Deletion is the first of these that acts on a trip's *existence*
rather than its contents. Every command so far — `AddDay`, `AddActivity`,
`MoveActivity`, and the rest — mutates what is inside a trip. Deletion asks a
different question: should this trip still be reachable at all? Because a trip
**is** its event stream (ADR-001), the question of how to represent "this trip
no longer exists" is really the question of how to represent that fact inside
the stream that *is* the trip, without breaking the guarantee that replaying
the log reproduces the trip's current state exactly.

## Decision

Deletion and restoration are modeled as ordinary domain events, symmetric with
every other command in the pipeline:

- `DeleteTrip` decides to `TripDeleted`.
- `RestoreTrip` decides to `TripRestored`.
- `TripState` gains a `status` field (`active` | `deleted`) that these two
  events toggle. `decide` gates every other command behind this status: once a
  trip is deleted, no further planning command is accepted against its stream
  until a `RestoreTrip` event is replayed ahead of it.
- The `trip_summaries` read model filters on `status` so deleted trips drop out
  of trip lists by default, without deleting any row or event.

Because deletion is just another event in the stream, rebuilding a trip's state
by replaying its log from empty reproduces the deletion (and any subsequent
restoration) exactly as it happened. Invariant 1 (state is a pure fold over the
event log) and Invariant 2 (replay reproduces current state) hold untouched —
no special-cased storage, no parallel "is this trip alive" table, no exception
carved into the replay path for the one property that must never have an
exception.

## Consequences

- **A deleted trip's data lives in the log forever.** There is no true erasure
  path here — deleting a trip removes it from view, not from storage. This is
  the correct trade-off for M8 (undo needs the data; the gate does not ask for
  erasure), but it matters the day a real privacy/right-to-erasure requirement
  appears: that will need a separate mechanism, because this one is
  deliberately not it.
- **`decide` grows a status guard that every future command inherits.** Any
  command added after M8 must be checked against `TripState.status` before it
  can run, the same way it is already checked against other invariants. This is
  a small, permanent tax on the command pipeline in exchange for deletion being
  a first-class, replay-safe event rather than a side channel.
- **Recovery is the undo toast plus per-trip restore, not a deleted-trips
  index.** Immediately after deleting, the user gets an undo affordance; after
  that, a trip can still be restored by visiting its own URL directly (which
  still resolves, since the row and stream still exist), but there is
  deliberately **no** surface that enumerates deleted trips for browsing or
  bulk recovery. Building that surface is out of scope for the gate this
  milestone closes, and would require the same trade-offs the "archive as a
  separate state" alternative below was rejected for.

## Alternatives rejected

- **Archive and delete as two separate evented states.** A three-state machine
  (active / archived / deleted) with its own transitions would let a user park
  a trip before fully deleting it, but it doubles the state machine `decide`
  and every projection have to account for, and it needs an archived-trips
  browsing surface the M8 gate does not ask for. Two states (active / deleted)
  cover the actual requirement — "a trip can be un-cluttered from the list and
  brought back" — without inventing a second lifecycle the product doesn't need
  yet.
- **Hard purge of the event rows.** Physically deleting a trip's events would
  be irreversible by construction, which conflicts with the undo/restore
  requirement outright. It would also orphan lineage pointers once M11's fork
  feature lands: a fork's ancestor stream could vanish out from under it if the
  source trip was ever purged, breaking a forked trip's history for reasons
  that have nothing to do with the fork itself. Soft delete via events keeps
  every stream permanently reconstructible, which both undo and future lineage
  depend on.
