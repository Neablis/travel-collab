# TODO — high-level roadmap for agents

How to use this file: find the first unchecked item — that is the current
work. Read its milestone file in `docs/milestones/` before planning anything.
Check items off only when the milestone's exit gate passes (not when code
merges). Never start an item while an earlier one is unchecked without
Mitchell's explicit say-so. Full process: `docs/guidelines/`.

**Scope for each milestone lives in `docs/milestones/README.md`** (the table),
and the detail plus exit gate in that milestone's own file. This file is the
checklist only — deliberately not a second copy of the scope, because two
copies drift.

Where the work actually stands right now: `docs/STATUS.md`.

## Phase 1 — Full single-player product

*Phase gate: Mitchell plans a real trip end-to-end and needs no other tool.*

- [x] **M0 Walking skeleton** → `docs/milestones/M0-walking-skeleton.md`
- [x] **M1 Planning core** → `docs/milestones/M1-planning-core.md`
- [x] **M2 History & time travel** → `docs/milestones/M2-history-time-travel.md`
- [x] **M3 Place & time** → `docs/milestones/M3-place-and-time.md`
- [x] **M4 Money & lenses** → `docs/milestones/M4-money-and-lenses.md`
- [x] **M5 Design foundations** → `docs/milestones/M5-design-foundations.md`
- [x] **M6 Atomic changes** → `docs/milestones/M6-atomic-changes.md`
- [x] **M7 Solo delight** → `docs/milestones/M7-solo-delight.md`
      *(Trip templates moved to M9 during this milestone.)*
- [ ] **Phase 1 gate review with Mitchell** — dogfood retro; go/no-go and
      backlog reshuffle before Phase 2. **Note: every milestone is ticked but
      the phase gate itself has not been met** — that is the gate doing its
      job, not a bookkeeping error.

## Phase 2 — Multi-persona

- [ ] **M8 Collaboration**

## Phase 3 — Outward

- [ ] **M9 Fork & lineage** *(inherits trip templates from M7)*
- [ ] **M10 Community** — all trust & safety scope lives here, nowhere earlier.
- [ ] **M11 Rich layer**

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
  **Thread (1), prompt trimming, was measured on 2026-07-27 and is NOT worth
  doing.** The per-round-trip payload is small: context envelope ~623 tokens for
  a 7-day/21-activity trip (board surface; 858 for `combined`), derived planning
  tool schemas ~816 tokens, system rules ~450 — about **1,900 tokens per model
  round-trip**. The live run that recorded ~33.5k input tokens was therefore
  ~18 round-trips, not a fat prompt: the cost was **step count**, which the
  2026-07-26 step-budget fix already addressed (system prompt now tells the
  model to emit every call in one message; typical runs should be 1–3 steps).
  Trimming `context.ts` would save tens of tokens per step and cost legibility.
  **Watch `meta.steps` instead — that is the cost driver, and it is already
  instrumented.**
  **Thread (2), the model harness, still stands and is the valuable half:**
  build a small harness that runs a fixed set of representative prompts (e.g.
  "plan a N-day trip", "move X to day 2", "add lunch on day 3") against several
  gateway models and records, per model, the `meta` we already emit
  (input/output tokens, steps, durationMs) alongside a quality score (did the
  batch apply? correct day placement? no dropped/duplicate commands?). Goal:
  pick the cheapest model that clears a quality bar. Weak models loop and
  over-generate; the harness makes that measurable instead of anecdotal. This
  doubles as the fix for KI-11 (no test ever calls a real model).

## Standing tasks (every milestone)

- **Preflight (kickoff):** before the milestone's first task, reconcile the
  *previous* milestone's gate-close checklist (`docs/milestones/README.md`) — if
  any flag is unflipped, flip it first. This is the forcing function that catches
  a missed gate-close.
- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- **At gate time, run the gate-close checklist** in `docs/milestones/README.md`
  (tick here, check the milestone file's exit-gate boxes, append the retro, bump
  Current milestone, update `docs/STATUS.md`, and remove the milestone's plan
  from `docs/plans/` after promoting anything durable out of it) — all in one
  commit, never a trailing manual step.
- Record any irreversible decision as an ADR before acting on it.
