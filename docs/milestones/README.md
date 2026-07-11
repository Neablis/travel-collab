# Milestones and gate discipline

Work proceeds through gates in order. A milestone is done when its **gate**
passes: a demo script runs clean, the test suite (including all prior
milestones' e2e scripts) is green, and a short retro note ("what we learned,
what changed") is committed. No building ahead of the current milestone.

Each milestone gets its own file here with an exit checklist before work on it
begins. Scope inside a milestone can flex; a gate definition changes only by
explicit decision from Mitchell, recorded in the file.

## Gate-close checklist (run in one commit when a milestone's gate passes)

A milestone's gate passing is the single trigger for flipping **every** status
flag, in **one commit** — never a trailing manual step (that is how M2 stayed
unticked). When the deployed gate demo passes:

1. Tick the milestone in `TODO.md`.
2. Check every exit-gate box in the milestone's own file (`docs/milestones/`).
3. Append the retro note to that milestone file.
4. Bump **Current milestone** at the bottom of this file — the single source of
   truth (`AGENTS.md` points here, so this is the *only* place the number
   changes).

The *next* milestone's plan opens with a preflight that re-checks this list
(`TODO.md` standing tasks), so a missed flag is caught at the next kickoff.

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
| M5 | Design foundations | Tailwind-based design system: global tokens, a documented color palette with usage guidelines (brand/semantic/gradients), styled reusable primitives (inputs, headings, text) and composites (forms, tables, modals), then a re-skin of every existing surface using only them. Purely presentational — no behavior/contract changes |
| M6 | Atomic changes | Client/generator-declared command groups: a series of commands committed as one atomic batch (one history entry) so undo/redo/revert treat them as a single change. Opt-in, all-or-nothing; the substrate templates + AI generation (M7) build on. ADR-010 due here |
| M7 | Solo delight | Trip notes page (basic rich text, no embeds), trip templates, AI generation (Claude emitting commands through the standard validation pipeline), polish pass |

## Phase 2 — Multi-persona

| # | Name | Scope |
|---|---|---|
| M8 | Collaboration | Invites, roles, revocation; near-real-time sync (transport ADR due here); concurrent-edit conflicts as resolvable data. Architecturally: swap the AccessPolicy implementation, broadcast events |

## Phase 3 — Outward

| # | Name | Scope |
|---|---|---|
| M9 | Fork & lineage | Clone-with-lineage, guided cherry-pick "merge", template sharing |
| M10 | Community | Share links with RBAC, public gallery, voting, reporting (all trust & safety scope quarantined here) |
| M11 | Rich layer | Notion-style pages with embedded community objects (TipTap ADR due here), external calendar sync (user's Google Calendar), dogfood-backlog items |

Placement notes (decided 2026-07-07):
- The notes page appears twice on purpose: basic solo notes in M7; embeds and
  community objects in M11.
- Internal calendar UX (drag, holiday anchors) is M3; *external* calendar sync
  is M11 — the original vision bundled these, they are different features.
- M2 precedes M3–M7 deliberately: prove history/revert works before investing
  in breadth on top of it.
- **Renumbering (2026-07-10):** M5 "Atomic changes" was inserted before Solo
  delight; milestones formerly M5–M9 shifted +1. Forward milestone-pointers in
  the ADRs, foundation spec, and guidelines were updated to match in the same
  change.
- **Renumbering (2026-07-11):** M5 "Design foundations" was inserted after
  Money & lenses (decided by Mitchell mid-M4: base functionality first, then a
  design-system pass before further UI breadth, so the polished single-player
  baseline can guide collaboration UX). Milestones formerly M5–M10 shifted +1
  (Atomic changes is now M6, …, Rich layer M11). Phase 1 is now M0–M7. Forward
  milestone-pointers updated to match in the same change.

Current milestone: **M4** — Money & lenses (see `M4-money-and-lenses.md`).
