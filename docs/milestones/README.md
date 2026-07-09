# Milestones and gate discipline

Work proceeds through gates in order. A milestone is done when its **gate**
passes: a demo script runs clean, the test suite (including all prior
milestones' e2e scripts) is green, and a short retro note ("what we learned,
what changed") is committed. No building ahead of the current milestone.

Each milestone gets its own file here with an exit checklist before work on it
begins. Scope inside a milestone can flex; a gate definition changes only by
explicit decision from Mitchell, recorded in the file.

## Phase 1 — Full single-player product

**Phase gate: Mitchell plans a real upcoming trip end-to-end with the product
and needs no other tool.** Deliberate trade-off (decided 2026-07-07): Phase 1
has zero network effects — validation is personal utility only — in exchange
for collaboration later landing on a product people already want to join.

| # | Name | Scope |
|---|---|---|
| M0 | Walking skeleton | Monorepo, CI, Google auth, event store, one command→event→projection→UI thread, deployed to Vercel |
| M1 | Planning core | Trips, days, activities; drag-to-reschedule; soft-conflict engine (overlaps, impossible geography) |
| M2 | History & time travel | History UI, undo, revert-to-state — proves the event-sourcing bet before stakes rise |
| M3 | Place & time | Map view (MapLibre), timeline view, calendar views; date-anchored events (holidays, weekly schedules) whose anchors produce soft conflicts when dates shift |
| M4 | Money & lenses | Cost items on activities/days/flights with rollup to trip; output lenses: itinerary, daily overview, full-trip overview |
| M5 | Solo delight | Trip notes page (basic rich text, no embeds), trip templates, AI generation (Claude emitting commands through the standard validation pipeline), polish pass |

## Phase 2 — Multi-persona

| # | Name | Scope |
|---|---|---|
| M6 | Collaboration | Invites, roles, revocation; near-real-time sync (transport ADR due here); concurrent-edit conflicts as resolvable data. Architecturally: swap the AccessPolicy implementation, broadcast events |

## Phase 3 — Outward

| # | Name | Scope |
|---|---|---|
| M7 | Fork & lineage | Clone-with-lineage, guided cherry-pick "merge", template sharing |
| M8 | Community | Share links with RBAC, public gallery, voting, reporting (all trust & safety scope quarantined here) |
| M9 | Rich layer | Notion-style pages with embedded community objects (TipTap ADR due here), external calendar sync (user's Google Calendar), dogfood-backlog items |

Placement notes (decided 2026-07-07):
- The notes page appears twice on purpose: basic solo notes in M5; embeds and
  community objects in M9.
- Internal calendar UX (drag, holiday anchors) is M3; *external* calendar sync
  is M9 — the original vision bundled these, they are different features.
- M2 precedes M3–M5 deliberately: prove history/revert works before investing
  in breadth on top of it.

Current milestone: **M3** — Place & time (no milestone file yet; write one before starting).
