# Validating direction — are we still building the right thing?

Quality enforcement (next guide) catches wrong code. This guide catches
correct code aimed at the wrong target.

## The definition of "the right thing"

In priority order:
1. The current milestone file's scope and exit gate (`docs/milestones/`).
2. The foundation spec (`docs/specs/2026-07-07-foundation-design.md`).
3. The ADRs.
If a task conflicts with these, the task is wrong or the docs are stale —
either way, stop and surface it to Mitchell. Never silently pick.

## Rhythm

- **Before starting work:** read `TODO.md` → the current milestone file. If
  the task isn't within the milestone's scope, don't build it. Useful ideas
  out of scope go to the milestone file's backlog note or a new `docs/` note —
  recorded, not built.
- **At every gate:** run the demo script live, full test suite including ALL
  prior milestones' e2e scripts, write the retro note ("what we learned, what
  changed"), and get Mitchell's explicit go before the next milestone starts.
- **Phase 1's ultimate gate is dogfooding:** Mitchell plans a real trip.
  Friction he hits outranks any planned backlog item.

## Drift signals — stop and escalate immediately

Architectural drift:
- Anything "needing" a write that bypasses the command pipeline.
- Projection rebuild diverging from stored state.
- Hand-written types shadowing contract schemas.
- UI importing domain/server internals; invite or permission logic appearing
  inside Trip Planning (AccessPolicy bypass).
- Event-sourcing creeping into CRUD modules, or CRUD shortcuts creeping into
  planning state (ADR-003 boundary smell).
- An event missing `actor_id`, or an owner-singleton sneaking into a query.

Product drift:
- Building ahead of the current milestone ("while I'm here…").
- Blocking modal errors for plan-consistency problems (violates
  conflicts-are-data).
- A feature that only makes sense multi-user being built during Phase 1.
- Solving merge/CRDT-shaped problems anywhere before M6 — that complexity is
  quarantined by decision.

## Escalation protocol

When blocked by an invariant, a constraint, or a doc conflict: (1) stop that
line of work; (2) write a short finding — what you tried, which rule blocked
it, 2–3 options with trade-offs and a recommendation; (3) put it in front of
Mitchell and continue on unblocked work. Decisions that are hard to reverse
(schema of persisted events, new dependencies, anything user-visible in a
gate) are Mitchell's to make, with your recommendation attached. Record what
he decides — ADR for irreversible ones, milestone-file note otherwise.

## Working agreement reminders

Discuss before building: new structure, scope changes, and design decisions
get explicit approval first. Challenge weak ideas directly — Mitchell asked
for pushback, not agreement. Report reality: failing tests, skipped steps,
and half-done work are stated plainly, never rounded up to "done".
