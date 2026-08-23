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
      *(Trip templates moved to M11 during this milestone.)*
- [x] **M8 Make it real** → `docs/milestones/M8-make-it-real.md`
      *(Gate closed 2026-08-08. Wave A merged 2026-08-07 via PR #21; Wave B
      (anchors/timezone/macro subtraction) merged the same day; Wave C's
      ergonomics tasks and Wave D's first-run/empty-state tasks trimmed from
      scope 2026-08-07 — see Candidate ideas below; C4 (KI-5 sync indicator)
      and D3 (e2e gate script) closed the gate.)*
- [x] **Phase 1 gate review with Mitchell** — done 2026-08-08. The 2026-07-28
      review had deferred this behind M8 (a trip could not be renamed or
      deleted); M8 closed that floor and the dogfood review passed.

## Phase 2 — A product worth using

- [ ] **M10 Visual craft pass** → `docs/milestones/M10-visual-craft.md`
      *(Brought forward ahead of M9, 2026-08-08 — see ADR-018. Wave 1's gate
      closed 2026-08-10 on PR #23, then **reopened 2026-08-14** by an external
      design review: the handoff had moved two generations since Wave 1 was
      built, and Wave 1's own assistant rail introduced three blocking defects.
      Wave 2 closes the delta — plan at
      `docs/plans/2026-08-14-M10-redesign-delta.md`, findings at
      `docs/design-feedback/2026-08-14-M10-redesign-external-review.md`.)*
- [ ] **M9 AI as a planning partner** → `docs/milestones/M9-ai-planning-partner.md`
      *(Blocked on M10's Wave-2 gate — do not start early.)*

## Phase 3 — Outward

- [ ] **M11 Fork & remix** *(inherits trip templates from M7)*
- [ ] **M12 Community** — all trust & safety scope lives here, nowhere earlier.
- [ ] **M13 Collaboration** — invites, roles, realtime transport ADR.
- [ ] **M14 Rich layer** — the macro vocabulary deferred out of M8 returns here.

## Candidate ideas (unscheduled)

Captured so they aren't lost; not committed to a milestone yet.

- **M8 Wave C/D trim: quick-add, search-to-add button, move-via-menu,
  first-run state, empty states (Mitchell, 2026-08-07).** Deferred out of M8
  rather than done reflexively, once Wave A merged. None of these close a
  capability gap: an activity — including one with a real geocoded place —
  can already be added via the existing `+ Add activity` editor
  (`ActivityEditor.tsx`/`LocationInput.tsx`), and reordering already works by
  dragging. What's deferred is speed (a faster input, a dedicated search
  button, a menu instead of a drag) and presentation (first-run/empty-state
  copy and layout) — genuine ergonomics and polish, but not blockers against
  the Phase 1 gate, and exactly the surface a separate, already-underway
  design-tool brainstorm for the product's future look and feel is likely to
  reshape. Building it now risks the "redone twice" cost M5's own Wave 1
  re-skin already paid once when the layout moved underneath it — the same
  argument M10's own scope doc makes about not polishing a structure that is
  still moving, applied here to interaction/ergonomics work instead of visual
  polish. **Kept, not deferred:** the KI-5 visible-sync-state indicator
  (correctness/trust, not ergonomics — doesn't depend on quick-add existing)
  and the M8 e2e gate script, resized to exercise the existing
  add-activity/drag-and-drop flow. Full reasoning in
  `docs/milestones/M8-make-it-real.md`'s "Scope trim" section — the original
  step-by-step plan (`docs/plans/2026-07-28-M8-make-it-real.md`, including
  the deferred C1–C3/D1–D2 task write-ups) was deleted at M8's gate close
  per `docs/plans/README.md`'s staging-area rule. Revisit once M10's
  direction is set — these are exactly the kind of task that direction
  should inform, not the reverse.

- **Trip list row: richer, human-readable metadata (Mitchell, 2026-08-01, from
  M8 dogfooding).** The "Your trips" list currently shows each row's
  `createdAt` as a raw ISO timestamp (`2026-08-01 23:52:35.026+00`) — should be
  human-readable, and more useful than the creation date anyway: start date,
  trip length (day count), and cost are all already on `TripSummary`/derivable
  from `TripDetail` and would tell the user more at a glance than when the row
  was created.

- **Duplicate and the undo-toast's Restore: no optimistic update yet (Mitchell,
  2026-08-01, from M8 dogfooding).** Delete's optimism (page.tsx's
  `deletingIds` filter-set, M8/A15 follow-up) and the rename/date/budget
  optimism fix (TripHeader reading `activeTrip` instead of `trip`) both landed
  as small, well-scoped fixes. Duplicate (network round-trip before the
  redirect fires) and Undo (`page.tsx`'s `undoDelete` does a full `load()`
  refetch rather than re-inserting the row locally) are lower-value/more work
  for now — deferred rather than done reflexively.

- **Expose geocoding as a model tool — now scoped into M9 as "Grounding"
  (`SearchPlaces` + `placeRef`).** Filed 2026-08-01 (Mitchell, M8 dogfooding)
  as the deferred half of the geocoding work: server-side auto-geocode was
  landing as the fix for the model guessing `Location.lat/lng` (observed:
  `lat: 0, lng: 0`), and giving the model a tool to *disambiguate candidates
  itself* was held back as more steps/tokens for cases "auto-geocode's 'take
  the top match' can't — e.g. two same-named places in different cities the
  model needs to pick between using trip context."
  **The 2026-08-02 dogfood run hit that exact case and the deferral proved
  wrong.** "The Red Coach Inn" top-matched to a coaching inn in Shropshire,
  England and overwrote coordinates the model had gotten right; seven more
  lookups were silently dropped by a rate limit (KI-15). Auto-geocode is not
  a weaker version of the tool — it is strictly worse than doing nothing when
  it is confidently wrong, because it launders a guess into a stored fact.
  Kept here only as the record of why it was deferred and what killed the
  deferral; the live scope is M9.

- **Contained activities: a meal inside a day-long activity is not a conflict
  (Mitchell, 2026-08-02, from M8 dogfooding).** Every day of the Rochester run
  raised a `time-overlap` warn, all three the same shape: a long anchor
  activity (Niagara Falls 09:00–16:00, the Strong Museum 10:00–16:00) and a
  lunch sitting *inside* it. The AI was not wrong — you *do* eat lunch during
  a museum day — and the user's reading was "we might want a feature for when
  the lunch is at the event." So this is not a prompt fix: telling the model
  the conflict rules would only teach it to stop scheduling lunch, which is
  worse. **The domain models overlap but has no notion of containment.**
  Directions to weigh in a brainstorm, not yet decided: (a) real nested/child
  activities in `packages/domain`; (b) a span/kind distinction so a long
  activity is a *container* rather than a peer; (c) leave the model alone and
  refine the rule in `conflicts.ts` — suppress `time-overlap` when one window
  fully contains the other and the inner one is short; (d) do nothing and let
  dismissal absorb it (status quo — but three warns on a three-day trip is
  the AI teaching users to ignore the conflict UI, which is the real cost).
  Note (c) is the cheapest and (a) is the most honest; the choice depends on
  whether containment ever needs to mean anything beyond silencing a warn.
  Deliberately kept out of M9 — it is a `packages/domain` contract question
  with conflict-detector consequences and deserves its own design pass.

- **AI "Preview" before apply — now scoped into M9.** Kept here only for the
  two implementation directions it records, which M9's design spec has to choose
  between (Mitchell, 2026-07-25): (a) lean on the event-sourcing/history
  substrate — a single pending "future" branch the user reviews and approves (or
  discards) to fast-forward into the real log; or (b) an intermediate, validated
  model of the proposed batch surfaced to the frontend for approval before it is
  applied. Becomes more valuable again at M13, where multiple actors make
  "propose then approve" a collaboration primitive rather than just an undo
  affordance.

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
  a missed gate-close. Also check for sibling `claude/*` branches on the
  *current* milestone (`git branch -a`, `git ls-remote --heads origin`) that
  might be finished-but-unmerged before starting more independent work on top —
  see `AGENTS.md`'s Workstreams section for why this matters and what it cost
  once already (M10 Wave 2 Phase 3 sat unmerged and diverged while Phase 4 was
  built and merged independently, 2026-08-22).
- Write the milestone file (scope + exit gate) before its first commit.
- Keep every prior milestone's e2e script green.
- **At gate time, run the gate-close checklist** in `docs/milestones/README.md`
  (tick here, check the milestone file's exit-gate boxes, append the retro, bump
  Current milestone, update `docs/STATUS.md`, and remove the milestone's plan
  from `docs/plans/` after promoting anything durable out of it) — all in one
  commit, never a trailing manual step.
- Record any irreversible decision as an ADR before acting on it.
