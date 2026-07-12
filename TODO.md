# TODO — high-level roadmap for agents

How to use this file: find the first unchecked item — that is the current
work. Read its milestone file in `docs/milestones/` before planning anything.
Check items off only when the milestone's exit gate passes (not when code
merges). Never start an item while an earlier one is unchecked without
Mitchell's explicit say-so. Full process: `docs/guidelines/`.

## Phase 1 — Full single-player product

*Phase gate: Mitchell plans a real trip end-to-end and needs no other tool.*

- [x] **M0 Walking skeleton** — monorepo, CI, Google auth, event store, one
      command→event→projection→UI thread, deployed to Vercel + Neon.
      → `docs/milestones/M0-walking-skeleton.md`
- [x] **M1 Planning core** — trips, days, activities, backlog, day-column
      board with drag; first soft-conflict rules (overlap, geography).
      → `docs/milestones/M1-planning-core.md`
- [x] **M2 History & time travel** — history UI, undo, revert-to-state;
      proves the event-sourcing bet.
- [x] **M3 Place & time** — map view (MapLibre), timeline, calendar views;
      date-anchored events; anchor-violation conflicts on date shifts.
- [x] **M4 Money & lenses** — cost items + rollups; itinerary / daily /
      full-trip output lenses.
- [ ] **M5 Design foundations** — Tailwind design tokens; documented color
      palette with usage guidelines; styled reusable primitives (inputs,
      headings, text) and composites (forms, tables, modals); re-skin every
      existing surface on top of them.
      → `docs/milestones/M5-design-foundations.md`
- [ ] **M6 Atomic changes** — client/generator-declared command groups: submit
      a series of commands as one atomic batch (one history entry) so undo/redo/
      revert treat them as a single change. Opt-in, all-or-nothing; the substrate
      templates + AI generation (M7) build on.
- [ ] **M7 Solo delight** — basic trip notes page (TipTap, no embeds), trip
      templates, AI generation via command pipeline, polish pass.
- [ ] **Phase 1 gate review with Mitchell** — dogfood retro; go/no-go and
      backlog reshuffle before Phase 2.

## Phase 2 — Multi-persona

- [ ] **M8 Collaboration** — invites, roles, revocation; realtime transport
      ADR + implementation; concurrent-edit conflicts as resolvable data.

## Phase 3 — Outward

- [ ] **M9 Fork & lineage** — clone-with-lineage, guided cherry-pick merge,
      template sharing.
- [ ] **M10 Community** — share RBAC, public gallery, voting, reporting
      (trust & safety scope lives here, nowhere earlier).
- [ ] **M11 Rich layer** — Notion-style pages with embedded objects, external
      calendar sync, dogfood-backlog items.

## Standing tasks (every milestone)

- **Preflight (kickoff):** before the milestone's first task, reconcile the
  *previous* milestone's gate-close checklist (`docs/milestones/README.md`) — if
  any flag is unflipped, flip it first. This is the forcing function that catches
  a missed gate-close.
- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- **At gate time, run the gate-close checklist** in `docs/milestones/README.md`
  (tick here, check the milestone file's exit-gate boxes, append the retro, bump
  Current milestone) — all in one commit, never a trailing manual step.
- Record any irreversible decision as an ADR before acting on it.
