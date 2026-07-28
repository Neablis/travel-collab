# ADR-001: Event-sourced modular monolith

**Status:** Accepted — 2026-07-07
**Deciders:** Mitchell (product/eng), Claude (architect)

## Context

The product requires, across its roadmap: immutable change history with undo and
revert, fork-with-lineage of whole trips, near-real-time multi-user editing,
concurrent-edit conflict surfacing, and soft plan-consistency validation. It is
built by one person plus AI agents, on free-tier infrastructure, over many
sessions. Agents must be able to work per-layer in parallel against stable
contracts.

Three concurrency/change models were considered:

1. **Event-sourced, near-real-time** — every change is an immutable event;
   edits apply live with field-level last-writer-wins; conflicts surface as
   resolvable objects.
2. **Git-style explicit commits** — drafts and changesets with a merge UI on
   conflicting saves. Purest version of the original vision, but async-only feel
   and a three-way structural merge UX is a large bet on non-technical users.
3. **Full CRDT (Yjs/Automerge)** — best live-editing feel, but structural
   history, revert, and fork/merge semantics become much harder to reason about,
   and the differentiating logic moves into a library we don't control.

Three deployment shapes were considered: modular monolith, single full-stack app
with no internal boundaries, and microservices.

## Decision

**Event sourcing is the core model.** All planning-domain writes flow
`command → validate → append event(s) → update projections`. The event log is
the sole source of truth; projections (read models) are disposable and
rebuildable. This applies from milestone zero, including single-player features,
so that history (M2), collaboration (M13), and forking (M11) are additive layers
rather than retrofits. The substrate's blast radius is deliberately scoped to
the planning domain — see ADR-003.

**Conflicts are data, not errors.** Plan-consistency violations (overlapping
locations, date-anchored events broken by a reschedule) and concurrent-edit
collisions are represented as `Conflict` objects with severity and suggested
resolutions. The UI presents them for resolution; it never hard-blocks.

**Fork = clone-with-lineage; merge = guided cherry-pick.** True three-way
structural merge is explicitly out of scope until user demand proves it
(see Consequences).

**Shape: modular monolith in a TypeScript monorepo.** Boundaries are packages
(`contracts`, `domain`) plus a UI/server split inside the app — the contract
lines agents work against — with the operational footprint of one deployable.

## Consequences

- Undo, history, audit, and fork-with-lineage fall out of the event log at low
  marginal cost; realtime becomes "broadcast events."
- Projections can be reshaped freely during pivots; truth is never migrated,
  only re-projected. A golden rebuild-equals-stored test guards this.
- We accept eventual-consistency wrinkles (projection lag) and the discipline
  cost: no direct table writes, ever.
- Field-level last-writer-wins means rare lost-update edge cases on the same
  field in the same instant; we accept this and surface it as a Conflict rather
  than adopting CRDTs.
- Deferring structural merge is a product bet. If real users demand true
  fork-merge, the event log gives us the raw material (per-fork event histories
  with a common ancestor) to build it later without a rewrite.
- Microservices rejected outright for a solo free-tier project; if scale ever
  demands it, package boundaries are the seams to cut along.
