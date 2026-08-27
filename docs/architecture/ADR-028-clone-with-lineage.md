# ADR-028 — Lineage is a genesis event field, and a viewer may clone

**Status:** Proposed (M11 link 5, 2026-08-27). Open to reversal.

**Depends on:** ADR-001 (fork-with-lineage falls out of the event log),
ADR-003 (event sourcing is scoped to planning), ADR-026 (roles), ADR-027
(pinned shares). **Supersedes** M8's decision 4, "Duplicate stays in M8,
lineage-free".

## Context

M11's third user story: *"Clone a trip someone shared with me into my own,
where it is editable because it is now mine."*

M8 shipped Duplicate deliberately lineage-free
(`2026-07-28-M8-make-it-real-design.md`, decision 4) — it wasn't in M8's exit
gate and lineage is M11's headline. This link is where that debt comes due.

## Decision 1 — lineage lives in `TripCreated`, not in a CRUD table

`forkedFrom: { tripId, atSeq, name } | null` on the `TripCreated` payload,
carried into `TripState`, `TripDetail`, and nothing else.

Unlike invites and shares (ADR-026, ADR-027), this is **not** Access data. It
is a fact about how a planning stream began — the foundation design has listed
it as part of a Trip since day one ("lineage pointer (`forkedFrom: {tripId,
atSeq}`)"), and ADR-001 names fork-with-lineage as one of the things the event
log gives for free. Putting it in a side table would mean a projection field
that is not rebuildable from the log, which breaks AGENTS.md invariant 2.

Being in the genesis event also gives immutability for free: no command
touches it, so there is nothing to keep consistent and no way to forge it
after the fact.

### `name` is a snapshot, and that is the point

The ancestor's name is **copied into the payload at fork time**, not looked up
at read time. Three reasons, in order of weight:

1. A cross-stream read at projection time would break rebuildability.
2. The credit has to survive the ancestor being renamed, deleted, or made
   unreadable — which is the *normal* case for a copy taken from a share link
   handed to a stranger.
3. Without it, the only honest thing the UI could say is "copied from another
   trip", which tells the reader nothing.

The cost is that the name goes stale. That is correct: it records what the
person was looking at when they copied it.

### Backwards compatibility

`.default(null)`, not `.optional()`, on all three of `CreateTrip`,
`TripCreatedV1.payload` and `TripDetail`. Every `TripCreated` row already in
`events` and every `trip_details.doc` already in Postgres omits the key, and a
default makes them all parse to one shape — explicit `null` — rather than two.
No migration, no event version bump. `hydrate()` additionally coalesces
`?? null`, because it is called on a raw `trip_details.doc` that never goes
through `TripDetail.parse`.

## Decision 2 — ids are NOT preserved across a clone

`remapIds` already minted fresh day and activity ids, with a comment saying
"preserving day ids is M11's decision to make, not a precedent this should
set". The decision is: **no**.

KI-1's own post-mortem is the argument. Its "reachability while it was open"
note says preserving day ids across a clone is "the obvious implementation"
and is exactly what would have made that latent `diffTripStates` ordering bug
active. The lineage pointer records the relationship instead — which is what
the relationship actually *is* — and costs nothing to carry.

## Decision 3 — a viewer may clone

The membership-only check `duplicateTrip` inherited was explicitly flagged as
"plausibly correct, decide it, do not inherit it". Decided: a **viewer may
duplicate**, and the check is now `hasAtLeast(actor, members, "viewer")`
rather than bare membership, so the rank is stated rather than implied.

Cloning creates a NEW stream owned by the cloner. It takes nothing from the
source and grants nothing on it. A viewer can already read every stop, day and
cost through the board, so refusing them a copy protects nothing and only
makes the product feel arbitrary. The asymmetry that would be worth defending
— a viewer handing out *access* — is a different operation, and is already
refused (they cannot invite, and cannot create a share link either).

A **stranger holding a share link** may also clone, through a different
endpoint (`POST /api/shares/:token/clone`) with no membership check and none
possible. That is the user story.

## Decision 4 — cloning a share copies the PINNED state

The link showed a particular point in history, and that is what its holder
chose to take. Copying the source's *current* state would mean the button
copies something the person never saw — and, since a share is often stale by
design (ADR-027), something the sharer may not have meant to hand over.

So `cloneSharedTrip` replays to `share.seq` and records
`forkedFrom.atSeq = share.seq`. Duplicating your own trip records the current
head instead, for the same reason: it is what you were looking at.

## Consequences

- `server/duplicateTrip.ts` became `server/cloneTrip.ts` with two entry
  points over one private `cloneFrom`. Notebook pages are still not copied
  (ADR-014); templating prose is link 6's bet.
- `packages/domain/test/support/tripGenerator.ts`'s `historyFrom` now takes
  `forkedFrom` as a parameter. No raw op can produce lineage, so a generator
  that hardcoded `null` would let every property built on it pass while never
  once seeing a forked trip — the hand-enumeration trap named in M18 PR 1's
  changelog, in its generator form. `diff.property.test.ts`'s round-trip
  property generates one and asserts replay carries it.
- `tripStatesEqual` compares lineage. Two states of one stream can never
  differ there, but that function is also what the rebuild golden test uses to
  compare stored against replayed, so a field replay dropped would otherwise
  pass silently.
- **The lineage line in Trip settings is deliberately not a link.** There is no
  guarantee the person holding a copy can open the trip it names. This is the
  decision here most likely to be worth overturning once there is a cheap way
  to ask "can I read that trip?" — the honest version is a link when you can
  and plain text when you cannot.
