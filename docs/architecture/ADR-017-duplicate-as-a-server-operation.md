# ADR-017: Duplicate as a server operation, not a domain command

**Status:** Accepted — 2026-07-28
**Deciders:** Mitchell (product/eng), Claude (architect)
Design spec: `docs/specs/2026-07-28-M8-make-it-real-design.md`

## Context

M8 adds trip duplication: making an independent copy of a trip a user already
has. Every existing `TripCommand` mutates exactly one stream — the one it is
addressed to. Duplication does not fit that shape at all: its entire purpose is
to **create a second stream** from the contents of the first. There is no
version of "duplicate" that reduces to appending an event to the source trip's
own stream, because the output of duplication is not a change to the source
trip — it is a whole new trip.

## Decision

Duplication is implemented as a plain server route, `POST
/api/trips/[tripId]/duplicate`, outside the command pipeline entirely:

1. Load the source trip's current `TripState`.
2. Remap every day id and activity id in that state to a fresh UUID, so the
   copy shares no identifiers with its source.
3. Compute `diffTripStates(empty, remapped)` and replay the resulting diff as
   one atomic batch against a brand-new stream (new `tripId`).

Duplicate is deliberately **not** a `TripCommand`, and it is deliberately
**not** added to `BatchableCommand`. A command that writes to a stream other
than the one it is addressed to would break the one-stream-per-command
invariant the whole pipeline is built on, and `BatchableCommand` is the schema
surface the AI gateway derives its planning tools from (ADR-015) — a
stream-creating operation has no business being an action the model can invoke
inline while editing a single trip. Stream-creating operations stay out of the
derived AI tool surface entirely.

## Consequences

- **The copy's history starts clean.** Because duplication replays a diff
  against an empty state rather than copying the source's raw event log, the
  new trip's history begins at "created" with no memory of the source trip's
  undos, reverts, or abandoned edits. This is the intended behavior: a
  duplicate is a fresh trip that happens to start from the same content, not a
  branch that carries its parent's editing history.
- **Duplication is planning-state only.** Because pages are a separate CRUD
  module outside the command pipeline (ADR-014), duplicating a trip's planning
  state does not touch its pages; page content is not copied by this
  operation. If page duplication is wanted later, it is a separate decision
  scoped to the pages module, not an extension of this one.
- **Fresh ids keep the two streams independent, and leave id-preservation
  decisions to M11.** Because every day and activity id is remapped, the
  duplicate and its source can be edited concurrently with no risk of one
  trip's ids colliding with the other's. This also means M8 takes no position
  on whether a future fork/lineage feature should preserve ids across a copy —
  that question is left entirely to M11 to decide on its own terms. Reusing
  source ids here would have been the exact hazard logged as KI-1: an id
  collision or ordering bug silently corrupting a trip that looks unrelated to
  the one being edited.

## Alternatives rejected

- **Copying raw events into a new stream.** Replaying the source trip's literal
  event log into a new stream would carry over every mistake, abandoned edit,
  and revert the source trip ever had, along with its full undo history. A
  duplicate should look like a fresh trip that happens to start pre-filled, not
  an editing session dragged along wholesale from its source.
- **A `DuplicateTrip` domain command.** Modeling duplication as a command on
  the source trip's stream would mean that command's decide/apply cycle writes
  to a stream other than its own `tripId` — the new trip's stream. That breaks
  the one-stream-per-command invariant every other command in the pipeline
  relies on, and would force every consumer of `TripCommand` (the pipeline,
  the batch queue, the AI tool derivation in ADR-015) to special-case the one
  command that secretly writes somewhere else. A server route sidesteps the
  problem instead of carving an exception into the domain model for it.
