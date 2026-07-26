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
- [x] **M5 Design foundations** — Tailwind design tokens; documented color
      palette with usage guidelines; styled reusable primitives (inputs,
      headings, text) and composites (forms, tables, modals); re-skin every
      existing surface on top of them.
      → `docs/milestones/M5-design-foundations.md`
- [x] **M6 Atomic changes** — client/generator-declared command groups: submit
      a series of commands as one atomic batch (one history entry) so undo/redo/
      revert treat them as a single change. Opt-in, all-or-nothing; the substrate
      templates + AI generation (M7) build on. Optimistic updates added to
      scope mid-milestone.
      → `docs/milestones/M6-atomic-changes.md`
- [x] **M7 Solo delight** — dynamic pages (TipTap) with typed macros that
      resolve live against trip state (registry-driven autocomplete +
      renderers), lazily-instantiated default templates (Trip Overview, Day
      Sheet), a Notebook route outside time-travel, and schema-derived AI
      page-authoring + plan-editing via Vercel AI Gateway (atomic batches for
      plan edits). Trip templates moved to M9.
      → `docs/milestones/M7-solo-delight.md`
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

## Candidate ideas (unscheduled)

Captured so they aren't lost; not committed to a milestone yet.

- **AI "Preview" before apply.** Let an AI plan-edit be *previewed and approved*
  before it becomes truth, instead of committing the atomic batch immediately.
  Two directions to explore (Mitchell, 2026-07-25): (a) lean on the
  event-sourcing/history substrate — a single pending "future" branch the user
  reviews and approves (or discards) to fast-forward into the real log; or (b) an
  intermediate, validated model of the proposed batch surfaced to the frontend
  for approval before it's applied. Natural fit alongside M8 (multi-actor makes
  "propose then approve" more valuable) or the M7 AI surface's own hardening.

- **AI cost/quality tuning — "best model for my buck" (Mitchell, 2026-07-25).**
  Two threads: (1) **Tighten the prompt for token efficiency** — the context
  envelope + system rules currently spend a lot of input tokens (a live run hit
  ~33.5k input for one trip). Audit `context.ts` (what the envelope inlines) and
  `handleAiRequest`'s system prompt for redundancy; trim to the minimum the tools
  actually need, and consider summarizing/omitting more of the trip on large
  trips. (2) **Measure cost vs. quality across models** — build a small harness
  that runs a fixed set of representative prompts (e.g. "plan a N-day trip",
  "move X to day 2", "add lunch on day 3") against several gateway models and
  records, per model, the `meta` we already emit (input/output tokens, steps,
  durationMs) alongside a quality score (did the batch apply? correct day
  placement? no dropped/duplicate commands?). Goal: pick the cheapest model that
  clears a quality bar, not the most expensive. Leverage the auditing `meta`
  added in M7 and the AI Gateway's per-model pricing. Weak models (e.g.
  deepseek-v4-flash) loop and over-generate; the harness makes that measurable
  instead of anecdotal.

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
