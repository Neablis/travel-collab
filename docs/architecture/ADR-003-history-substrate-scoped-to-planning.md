# ADR-003: History substrate scoped to the planning domain

**Status:** Accepted — 2026-07-07
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

ADR-001 chose event sourcing as the core change model. The open question was its
blast radius: which parts of the system live on the event log? The product
promise — "immutable source control for the actions taken on the vacation" —
is about trips, not the whole application.

Options considered:

- **A. Whole-app substrate.** Everything event-sourced, including identity and
  access. Maximum consistency; maximum ceremony — including for features that
  will never need time travel (nobody reverts a login).
- **B. History as a peer module.** Ordinary mutable CRUD everywhere, plus a
  history/audit service modules notify. Rejected for the **dual-write problem**:
  the moment any code path updates state without recording history — one bug,
  one raw SQL fix — revert is silently broken and the log can never be trusted
  again. Fork/merge is near-impossible when the log is not authoritative. This
  is the "add versioning later" retrofit trap.
- **C. Substrate scoped to the planning domain.** Trip Planning (and later,
  trip-page content) is event-sourced; Identity, Access & Membership, and
  Community metadata are ordinary CRUD with audit fields.
- **Snapshot-per-change** (git-like whole-document versions instead of events)
  was also weighed and consciously rejected: it lacks operation-level
  granularity ("Alice moved the Colosseum to Tuesday"), which Phase 2/3 need
  for meaningful concurrent-edit conflicts and readable history. Snapshots are
  retained only as a replay optimization inside the event store.

## Decision

**Option C.** The event log is the sole source of truth for the planning
domain. Undo, revert, history, fork-with-lineage, and (later) concurrent-edit
machinery exist only there. Identity, Access & Membership, and Community
metadata use conventional CRUD with audit fields; revoking an invite is a
domain action, not a history rewind.

## Consequences

- The event-sourcing tax (command/event/projection ceremony, event-schema
  versioning via upcasters) is paid exactly where the product promise needs it.
- Selective undo requires each planning event type to declare its inverse —
  history is ~90% generic mechanism, ~10% per-event-type cooperation. Accepted.
- Event schemas are forever: changes to planning entities require versioned
  events and upcasters so old logs replay. This is the known long-term cost.
- The on-substrate / CRUD boundary must stay crisp. A feature needing half its
  state evented and half not is a design smell to escalate, not hack around.
- Whether membership changes are *additionally* mirrored into a trip's stream
  (for activity-feed purposes) is deferred to Phase 2.
