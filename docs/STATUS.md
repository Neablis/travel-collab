# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-08-23 (M10 Wave 2 Phase 4 — budget/cost surfacing —
landed; Phase 3 — the unscheduled rack — turned out to be already built on
an unmerged branch, discovered only now; land it before anything else, see
"Known gap" below)**

## Where we are

**M0–M8 are complete and merged. M10 is in flight, not done.** M8 ("Make it
real") closed its gate 2026-08-08. M10 ("Visual craft pass", brought forward
ahead of M9 per ADR-018) closed a **Wave-1** gate 2026-08-10 on branch
`claude/m10-trip-planner-visual-7bbacf` (PR #23). **PR #23 merged to `main`
2026-08-17**, carrying Wave 1 plus Wave-2 Phases 0-2 (blockers, structure,
map) — the PR had grown to 79 commits / 161 files and was split rather than
held open until the full Wave-2 gate closed; see the milestone file's "PR #23
merged as a partial delta" section for why, and note that **this does not
close M10's gate** (below). Wave-2 Phases 3-9 continue on a follow-up branch.

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

**2026-08-19: feature flagging and an AI kill switch landed as a deliberate
off-roadmap insert, ahead of M10 Wave 2 Phase 3.** `AGENTS.md` requires scope
creep past the current milestone's gate to be called out rather than
silently absorbed — this is that call-out. The driving need was external to
the roadmap: the app is about to be shared publicly, and
`AI_GATEWAY_API_KEY` (ADR-015) sat behind `/api/trips/:id/ai` with nothing
stopping an authenticated visitor from calling it in a loop. The Flags SDK
(Vercel adapter) is now the project's first flag mechanism; its first and
only consumer is an `ai-live` flag that swaps the injected model rather than
branching the handler, so "off" still exercises the real pipeline and marks
the response `simulated: true`. See ADR-019
(`docs/architecture/ADR-019-feature-flags-and-simulated-model-seam.md`) and
the design spec
(`docs/specs/2026-08-19-feature-flags-and-ai-kill-switch-design.md`). **This
does not reopen or move M10's gate** — M10 Wave 2 Phase 3 (the unscheduled
rack) remains exactly the resume-from-here point described below.

**This insert closed 2026-08-22, PR #24.** Task-by-task implementation review
plus a final whole-branch security review (no kill-switch bypass found) both
passed; a fix wave addressed 2 Important findings (a fail-closed gap in
`aiLive()` when the Flags service errors before `decide()` runs, and the
flag-on/no-gateway-key case returning a bare 500 instead of the handler's
standard error envelope) and several Minor ones (a11y, lint-wall scoping,
doc accuracy). Mitchell manually verified the deployed behavior end to end
before merge. Two items were deliberately left open rather than folded in —
see `docs/known-issues.md` KI-23 and KI-24. The plan
(`docs/plans/2026-08-19-feature-flags-and-ai-kill-switch.md`) is removed in
this same commit per `docs/plans/README.md`'s staging-area rule; its durable
content lives in ADR-019, this file, and the known-issues entries above.

## In flight

**M10 Wave 2 — Phases 0, 1 and 2 merged to `main`; Phases 3 and 4 are BOTH
done but only Phase 4 is merged.** Phase 3 (the unscheduled rack) is fully
built and verified on branch `claude/m10-phase-3-rack` — but it was never
opened as a PR, and it now needs to be landed before anything else, not
started fresh. See "Known gap: Phase 3 built but unmerged" below before
picking up any new Wave-2 work.

Progress below was reconstructed 2026-08-17 from the code and commit
history, not from a task-by-task log kept during the work — this file had
not been updated since the plan was written, so treat this section as the
source of truth over anything phase-status-shaped said earlier in this file.

**Between that reconstruction (2026-08-17) and now, three things happened:**
feature flags and the AI kill switch (2026-08-19, `5c5379e`..`b865537`, PR
#24 — see "Where we are" above and ADR-019; an off-roadmap insert, touched
none of Phases 0-9); **Phase 3 (rack) — built and verified 2026-08-22 on
`claude/m10-phase-3-rack`, but never merged** (see below); and **Phase 4
(budget) — done and merged, out of the plan's documented phase order**
(2026-08-22/23, PR #25, branch `claude/m10-phase-4-budget`). The plan's own
file (`phase-4-budget.md`) correctly noted Phase 4 is independent of Phase 3
and could go in parallel; a separate session picked it up directly rather
than waiting on Phase 3, without checking whether Phase 3's own branch was
already finished and awaiting a PR. Phase 4 delivered: per-stop/per-day/
per-trip cost surfaced (`TimelineLens`, `ActivityCard`, home hero/cards,
routed through the single `formatMoney` formatter), `daySpend` reading the
server-computed `costSubtotal` instead of a client re-sum (closes **KI-2**
against the current design), the Trip settings sheet rebuilt to the redesign
(budget + currency inputs, real `BudgetMeter`, over-budget banner), and the
Dates row restored as a real, clickable control opening `TripDateControl` in
a popover (closes **D-2** — the prior "dormant, no mount point" read was a
genuine capability-loss bug, not a deliberate deferral; corrected on
discovery). Also filed **KI-26** (a cosmetic `@vercel/flags-definitions`
build warning noticed while diagnosing CI) and **KI-27** (local e2e against
`pnpm dev` gave two false signals during this phase's CI diagnosis — a real
regression initially masked, and a fixed bug that looked uncertain —
because CI actually runs against a production build; both need a real look,
see `docs/known-issues.md`).

### Known gap: Phase 3 built but unmerged — land this before anything else

`claude/m10-phase-3-rack` (also pushed to origin) has Phase 3 fully done:
`lib/time.ts` (`toMinutes`/`toTimeString`, moved out of `TimelineLens.tsx`),
`unscheduledRack.ts` (`fitIntoDay`), `UnscheduledRack.tsx` (the sticky
bottom drawer, mounted once in `TripBoardScreen` outside the lens switch),
`board/resolveDrop.ts` and `trip/rackDisclosure.ts` (pure logic extracted
for real unit coverage, since jsdom has no `DataTransfer`/`DragEvent`), a
dedicated `e2e/m10-unscheduled-rack.spec.ts`, and selector updates to five
other e2e specs. Verified on that branch 2026-08-22 by walking the exit
checklist in a real browser, plus unit/int/e2e all green. **Never opened as
a PR.** It diverged from `main` 12 commits each way once Phase 4 merged —
expect a real conflict in `TimelineLens.tsx`, which both phases touched
(Phase 3 moved two functions out of it; Phase 4 added per-day cost display
to it). This was discovered late, by a fresh session's own stale task list
still claiming Phase 3 "done" days after the fact — see `AGENTS.md`'s
Workstreams section for the process rule this added to prevent a repeat.
**Land Phase 3 (merge `main` in, resolve the `TimelineLens.tsx` conflict,
re-verify everything including e2e against a production build per KI-27,
open a PR, drive it to green) before starting Phase 5, 6, 7, or 8 —** Phase
6 and 7 both depend on Phase 3's code existing on `main`, not just on a
branch.

- **Phase 0 (blockers) — done.** The assistant-rail scrim is a real dismiss
  control (`fe6c0f7`), sheets/dialogs stack above the rail (`d473cb2`,
  `d0b1f32`), the rail auto-hides below its overlay breakpoint (`7fb872a`).
  KI-16 and KI-17 are marked RESOLVED in `docs/known-issues.md` accordingly
  (2026-08-17, closing a doc-lag from this same review — the fixes had landed
  2026-08-14 but the entries weren't updated at the time).
- **Phase 1 (structure) — done.** Global `AppHeader` with Trips/Playbooks nav
  (`6308440`), four peer view tabs replacing the "More" popover (`7bac066`),
  tabs and day chips pinned inside the sticky header (`47c83ba`), header meta
  pill and budget chip wired to real trip data (`5d91917`).
- **Phase 2 (map) — done, plus more.** `MapRail`, `MapFocusCard` and
  `mapRailData` all shipped (`5c099ae`, `6123cfb`, `2701db1`, `3ebaa7d`). This
  grew into its own sub-effort beyond the phase file's scope — map-rail
  scroll-focus tracking got a dedicated design doc, plan and retro
  (`7ab4387`, `2f15cb7`, `04311b3` … `3251ea3`), landing 2026-08-14 through
  2026-08-16 and closing with two process amendments adopted into `AGENTS.md`
  (`6708fb3`). It also filed **KI-21** (intermittent `dragCardTo` flakiness
  under load, confirmed unrelated to any branch's code — see the entry).
- **On `main` right now: Phases 5-9 not started, Phase 3 built but not
  merged (see "Known gap" above), Phase 4 done.** Verified by absence in
  `main`'s tree, not just by an unchecked plan file (the phase files' own
  `- [ ]` step markers are never checked regardless of completion, so they
  aren't a reliable signal on their own) — but "absent from `main`" is not
  the same claim as "not started": check `claude/*` branches too before
  assuming a phase with nothing on `main` is untouched.
  - **Phase 3 (rack):** absent from `main` — `UnscheduledRack.tsx`,
    `unscheduledRack.ts`, `lib/time.ts` don't exist there, `Board.tsx` still
    renders the backlog as the old column. **All of it exists, done and
    verified, on `claude/m10-phase-3-rack` — see "Known gap" above.**
  - **Phase 4 (budget) — done, merged to `main`** (PR #25, 2026-08-22/23).
  - **Phase 5 (overlaps):** no `OverlapWarning.tsx` / `overlapData.ts`; no
    `time-overlap` handling in `TimelineLens`.
  - **Phase 6 (add-a-day, empty states):** depends on Phase 3; untouched.
  - **Phase 7 (forms):** `ActivityEditorSheet.tsx` last touched 2026-08-09
    (Wave 1), before the Wave-2 delta plan existed. Still the pre-M10 editor.
  - **Phase 8 (polish, incl. home):** the home hero/cards that exist
    (`NextTripHero`, `TripCard`) are Wave-1 work from 2026-08-08 to 08-11,
    predating this plan. Task 8.5's specific fixes are unapplied —
    `NextTripHero.tsx:154` still hardcodes `label="travelers"` (no
    singularization), no `page-date-line` testid, no "All trips" heading, the
    third stat tile is still the fabricated `value="2"`. Task 8.2's day-accent
    collision-probing fix (KI-18) is also unapplied — `lib/dayAccent.ts` has
    no probing logic yet.
  - **Phase 9 (gate):** not run.

The plan itself:

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

**Do not start Phase 3 from scratch — it is already built on
`claude/m10-phase-3-rack`.** See "Known gap: Phase 3 built but unmerged"
above. Land that branch (rebase/merge `main` in, resolve the
`TimelineLens.tsx` conflict, re-verify, PR, merge) before picking up new
phase work — Phases 6 and 7 depend on Phase 3's code being on `main`, not
just on a branch, so landing it unblocks the most follow-on work. Phases 5
and 8 remain independent of Phase 3 and of each other and could go in
parallel once Phase 3 is landed (or even before, but check for their own
stray branches first — see `AGENTS.md`'s Workstreams section — before
assuming either is untouched). Branch any genuinely new phase work from
current `main`, not from PR #23's old branch (merged, empty diff against
`main` now) or from any other stale branch without checking it first.

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

**PR #23 merged to `main` 2026-08-17** (see "Where we are" above). The Wave-1
record in `docs/milestones/M10-visual-craft.md` stands as written — it was
true against the handoff generation available then — with "Gate reopened" and
"PR #23 merged as a partial delta" sections appended rather than the closed
record being rewritten.

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

**Land Phase 3 first** — it is already built on `claude/m10-phase-3-rack`
but never merged; see "Known gap: Phase 3 built but unmerged" above. Do not
re-execute `docs/plans/M10-delta/phase-3-rack.md` from scratch. Once landed,
continue M10 Wave 2's remaining phases (5, 6, 7, 8) task-by-task through
Phase 9's gate (`docs/plans/M10-delta/phase-9-gate.md`): before/after
screenshots, KI-2/3/4 closed or re-deferred, presentational-only diff
verified, all tests incl. e2e green, retro appended. M9 resumes once M10's
gate closes.

(`docs/plans/2026-08-08-M10-redesign-incorporation.md`, referenced by this
line in earlier updates, was Wave 1's plan — it was deleted at Wave 1's gate
close per `docs/plans/README.md`'s staging-area rule. Wave 2's plan lives at
`docs/plans/2026-08-14-M10-redesign-delta.md` instead.)

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
