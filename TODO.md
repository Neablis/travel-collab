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
- [ ] **M2 History & time travel** — history UI, undo, revert-to-state;
      proves the event-sourcing bet.
- [ ] **M3 Place & time** — map view (MapLibre), timeline, calendar views;
      date-anchored events; anchor-violation conflicts on date shifts.
- [ ] **M4 Money & lenses** — cost items + rollups; itinerary / daily /
      full-trip output lenses.
- [ ] **M5 Solo delight** — basic trip notes page (TipTap, no embeds), trip
      templates, AI generation via command pipeline, polish pass.
- [ ] **Phase 1 gate review with Mitchell** — dogfood retro; go/no-go and
      backlog reshuffle before Phase 2.

## Phase 2 — Multi-persona

- [ ] **M6 Collaboration** — invites, roles, revocation; realtime transport
      ADR + implementation; concurrent-edit conflicts as resolvable data.

## Phase 3 — Outward

- [ ] **M7 Fork & lineage** — clone-with-lineage, guided cherry-pick merge,
      template sharing.
- [ ] **M8 Community** — share RBAC, public gallery, voting, reporting
      (trust & safety scope lives here, nowhere earlier).
- [ ] **M9 Rich layer** — Notion-style pages with embedded objects, external
      calendar sync, dogfood-backlog items.

## Standing tasks (every milestone)

- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- Append a retro note to the milestone file at gate time.
- Record any irreversible decision as an ADR before acting on it.
