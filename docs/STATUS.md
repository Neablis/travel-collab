# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-08-14 (M10 gate reopened — Wave 2 planned, not started)**

## Where we are

**M0–M8 are complete and merged. M10 is in flight, not done.** M8 ("Make it
real") closed its gate 2026-08-08. M10 ("Visual craft pass", brought forward
ahead of M9 per ADR-018) closed a **Wave-1** gate 2026-08-10 — but on branch
`claude/m10-trip-planner-visual-7bbacf` (PR #23), which **is still unmerged**,
so nothing of M10 is on `main`.

**M10's gate was reopened 2026-08-14** after an external design review Mitchell
requested. Two findings, neither of which the Wave-1 gate could have caught:

1. **The design handoff had moved two generations.** Wave 1 was built against a
   1,412-line prototype; `~/Downloads/design_handoff_update/` contains a
   2,048-line version (688 changed lines — this is the one that added the **Map
   view**) and a 2,623-line current version (+612/−37 — the **unscheduled rack**,
   **budget and per-stop costs**, **overlap warnings**, the **Trip settings
   sheet**, **add-a-day**, and the **header meta pill**).
2. **Three blocking defects in Wave 1's own new assistant rail.** The worst: the
   rail's scrim (`fixed inset-0 z-40`, pointer events on, no click handler) makes
   the entire trip page inert below 1180px. The e2e suite is structurally blind
   to it — `apps/web/playwright.config.ts` sets no `viewport`, so all 11 specs
   run at Playwright's 1280px default, above the 1179px breakpoint where the
   scrim turns on. That is why the gate passed 11/11 against a production build
   while the page was dead at 1100px.

**The Phase 1 gate review with Mitchell is done (2026-08-08).**

**Current milestone is M10, Wave 2.** M9 does not start until it passes. Order:
`M8 ✓ → [Phase 1 gate review ✓] → M10 (Wave 2, now) → M9 → M11 → …`.

## In flight

**M10 Wave 2 — planned, not started. This is the resume-from-here point.**

The plan is written and ready to execute task-by-task:

- **Index:** `docs/plans/2026-08-14-M10-redesign-delta.md` — goal, global
  constraints, file map, phase order. **Read this first.**
- **Phases:** `docs/plans/M10-delta/phase-N-*.md`, ten files, 28 tasks. Execute
  one file at a time, in order. Each is self-contained, carries its own literal
  design values, and includes real test code — written so a smaller model can
  run it without re-deriving anything.
- **Findings it came from:**
  `docs/design-feedback/2026-08-14-M10-redesign-external-review.md`.
- **Design source of truth:**
  `~/Downloads/design_handoff_update/current/Trip Planner Redesign.dc.html`
  (2,623 lines). `previous/` is for reading the diff only. The bundle's own
  `AGENT-PROMPT.md` claims `previous/` is what we built from — **it is not**;
  we built from the older 1,412-line file, which is why there are two
  generations of drift.

**Start with Phase 0.** Its three tasks are bugs, not design gaps, and
everything else is hard to verify while the trip page is inert below 1180px.

**The scoping rule for all of Wave 2** (Mitchell, 2026-08-14): *build on what
exists in the data model; implement the UI for things we can't build today and
wrap those in the under-construction `<Preview>` treatment.* Reviewing the
contracts against the design showed most of what it needs is already modelled —
`ActivityView.cost`, `trip.budget`/`currency`, `TripDetail.tripCostTotal` and
`.budgetRemaining` (**server-computed; never re-sum them client-side**),
`trip.backlog`, `Location.lat/lng`, and the `time-overlap` / `over-budget`
conflict rules. Only confirmed-vs-estimate cost state, "was on day N"
provenance, and invite roles are genuinely missing, and those get Previews
rather than contract changes.

**PR #23 is still open and unmerged.** Wave 2 builds on it. The Wave-1 record in
`docs/milestones/M10-visual-craft.md` stands as written — it was true against the
handoff generation available then — with a "Gate reopened" section appended
rather than the closed record being rewritten.

**Wave 1's own plan** (`docs/plans/2026-08-08-M10-redesign-incorporation.md`) was
deleted at its gate close per `docs/plans/README.md`'s staging-area rule.

**One approved, intentional exception to M10's presentational-only rule:**
KI-2's fix required a `packages/domain` change (`conflicts.ts`'s `fmt`,
grouped to match the UI's money formatting) — Mitchell explicitly chose "fix
it anyway, escalate the diff" over re-deferring when this was raised mid-build.
Recorded in the M10 retro and in `docs/known-issues.md`.

M8 is fully closed: Wave A (trip lifecycle, PR #21, merged 2026-08-07), Wave B
(anchors-UI retirement, `ConflictContext.timezone` removal, Notebook
macro-authoring pullback — merged 2026-08-07, commit `bc2295e`), and Wave C/D's
kept tasks — **C4** (the KI-5 sync indicator, `SyncIndicator.tsx` in
`TripHeader`) and **D3** (the M8 e2e gate script,
`apps/web/e2e/m8-make-it-real.spec.ts`) — are all done and merged to this
branch. C1–C3 (quick-add, search-to-add, move-via-menu) and D1–D2 (first-run
state, empty states) remain **deferred** per the 2026-08-07 scope trim; do
not start them without Mitchell's explicit say-so. Full reasoning:
`docs/milestones/M8-make-it-real.md`'s "Scope trim" section and `TODO.md`'s
Candidate ideas.

**Found and fixed while closing the gate, not introduced by C4/D3:** Wave B's
own UI removals (anchors editor, macro autocomplete) had left two prior
milestones' e2e scripts red since 2026-08-07 — `m3-place-and-time.spec.ts`
drove the deleted anchor-editing UI, and `m7-solo-delight.spec.ts` asserted
macro nodes the seeded Notebook templates no longer plant by default. Neither
had been re-run since Wave B merged (its own final review checked
typecheck/lint/vitest but not e2e). Both are rewritten to match current
behavior — see the "What changed" section of the M8 retro for exactly what
each now covers and what coverage moved to unit/int level instead. This is
recorded here, not just in the commit message, because it's the kind of
"e2e went stale and nobody noticed" gap `docs/milestones/README.md`'s gate
discipline is supposed to prevent — worth watching for at the next wave/
milestone boundary too.

Verified clean at gate close: `pnpm typecheck`, `pnpm lint`, `@tc/contracts`
+ `@tc/domain` + `apps/web` unit vitest (all green, including the two
previously-flaky KI-13 tests — `PageScreen.test.tsx`, `TripHeader.test.tsx`
— passing in this run), `apps/web` int vitest (real Postgres), and the full
e2e suite (8 spec files / 11 tests) — twice in a row, against a production
build (`pnpm build && pnpm start`) to match CI rather than dev-mode Turbopack
(whose cold-compile delay on first navigation is otherwise easy to
mistake for a real failure locally).

`docs/plans/2026-07-28-M8-make-it-real.md` (the implementation plan referenced
in prior updates to this file) is deleted as of this gate close, per
`docs/plans/README.md`'s "plans are staging-area artifacts" rule — its durable
content is now in this file, the M8 milestone file's retro, and
`docs/known-issues.md`.

**One still-open item from Wave B's B1 (anchors retirement):** its production
safety check (confirm no live trip already carries an anchor, via a `psql`
count against `PRODUCTION_DATABASE_URL`) was explicitly skipped on Mitchell's
instruction — `PRODUCTION_DATABASE_URL` isn't available outside CI. If it's
ever run and returns non-zero, clear those anchors with an `UpdateActivity`
command (`anchors: []`) per activity, never by writing the projection
directly (Invariant 1); until then an activity with a pre-existing anchor
would keep firing an anchor-violation conflict with no UI surface to explain
or clear it (the dormancy the rest of B1 relies on).

## Blocking / broken right now

**Nothing blocking.** **KI-15 is downgraded, not closed:** the
silent-corruption half — an unbiased top-match overwriting correct
model-supplied coordinates, and rate-limit failures silently swallowed into
coordinate-less locations — is fixed (see the entry in `docs/known-issues.md`
for what changed and what is still open). The remaining, architectural half
— the model still guesses a coordinate rather than citing a real one — is M9
("Grounding") scope.

`main` went fully green for the first time on 2026-07-28 — all four
CI jobs including `migrate-production`, which applied migration `0003` (the
`pages` table) to production after the `PRODUCTION_DATABASE_URL` secret was set.
The M7 Notebook should now work on the deployed app; it had been failing there
since M7 merged.

Cleared on 2026-07-27/28: the production migration blocker (open since
2026-07-13); **KI-1**, `diffTripStates` silently dropping day order — a real
correctness bug, not the flake it had been filed as for two weeks; the
`evolveTrip` replay-totality hole; **KI-14**, dismissed conflicts suppressing a
re-created problem forever; and M7's stranded post-gate retro plus KI-11/12/13,
which existed only on a branch.

## Next action

**Execute M10's plan task-by-task** (`docs/plans/2026-08-08-M10-redesign-incorporation.md`),
then close its gate per the rewritten `docs/milestones/M10-visual-craft.md`
exit gate (before/after screenshots, KI-2/3/4 closed or re-deferred,
presentational-only diff verified, all tests incl. e2e green, retro appended).
M9 resumes once M10's gate closes.

Background on why M8 existed: **M8 — Make it real**
(`docs/milestones/M8-make-it-real.md`). The Phase 1 gate review ran on
2026-07-28 without the dogfood data, because the dogfood could not be
attempted: a trip cannot be renamed or deleted. M8 closed that floor; its
gate (create/name/date/build/reorder/rename/delete without asking how
anything works, scripted end-to-end in
`apps/web/e2e/m8-make-it-real.spec.ts`) passed 2026-08-08.

The roadmap was restructured in the 2026-07-28 review — M8/M9/M10 are new, Fork
& remix moved ahead of Collaboration, and everything from the old M8 onward
renumbered. `docs/milestones/README.md` carries the mapping; closed milestone
files and closed design specs were deliberately not rewritten.
