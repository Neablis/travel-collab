# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-08-25 — Phase 8b is open as PR #46 and has grown well
past its plan.** The branch `claude/m10-wave2-phase8b` now carries **25
commits / ~75 files**, not the six Phase 8b's plan describes. What was added
after the phase tasks, in order: a **preview-only demo-data reset** endpoint
and account-menu action (dev tooling, not plan scope — see its own section
below), **geocoded coordinates** for the Japan seed, a **full calendar-cell
rebuild** after the first attempt was reported wrong, five **CodeRabbit**
fixes, and **20 preview-review comments** from Mitchell across three rounds.
CI is green on the branch head `111caac` — `static-checks`, `unit-tests`,
`integration-e2e`, `Vercel`, `Vercel Preview Comments` and `CodeRabbit` all
pass, `migrate-production` correctly skipped. All 20 preview threads are
resolved, and CodeRabbit's final pass posted **nothing new**.

**CodeRabbit over three passes: 16 findings — 12 fixed, 2 declined on the
merits (it later conceded both), 2 were its own replies.** Its best catch was
a bug this session caused: after the loop that *drew* backlog markers was
removed, `activityPins` still fed the map's initial centre, so the map could
centre on an activity it deliberately does not plot, and a backlog-only trip
rendered a blank canvas instead of the empty state (`111caac`). It also named
two wrong seed pins nobody had spotted — see KI-39 below.

**Three known issues were filed off this branch besides KI-36:** **KI-37**
(`commandsFor` emits a malformed `TimeWindow.start` for the second activity on
a day), **KI-38** (`uuidFrom` silently returns malformed UUIDs above 0xFFFF
instead of throwing) and **KI-39** (the seed geocoder's city-box acceptance
test). KI-37 and KI-38 are both in `@tc/factories` and were surfaced by
accident; neither is fixed, because `packages/` is off-limits on this branch.

**Read this before the Phase 9 gate: the "presentational only" gate box is
under real strain.** This branch contains a route that soft-deletes user
data, a new env gate, a JSON importer, and two behavioural changes (conflict
alerts are now clickable; the unscheduled rack is hidden on the Map lens).
The whole-branch reviewer's position, recorded verbatim in PR #46, was that
the demo-data work should have been its own PR: *"the five reviewed tasks and
the one unreviewed destructive endpoint now carry the same approval stamp."*
Mitchell merged it in deliberately, to test the phase UI against rich data on
one preview URL. Whoever runs Phase 9 should decide consciously whether this
still counts as a presentational wave, rather than inheriting the assumption.

**A CI gotcha this cost time on:** `Vercel Preview Comments` is a **one-shot
snapshot** posted by the Vercel app when a deployment completes — `started_at
== completed_at`. Resolving threads does **not** re-evaluate it, and GitHub's
re-run button does nothing because Actions doesn't own that check. It only
recomputes on a **new deployment**. If it reads red while the threads are
demonstrably resolved, push a commit; do not go hunting for unresolved
feedback. (Separately: 16 unresolved threads still sit on the long-dead
`m5-design-foundations` branch, two of them saying a fix never landed. They
do not affect this check — it is branch-scoped — but nobody has closed them.)

**Previously (2026-08-24): Phase 8b implemented, awaiting a PR.** `main` is
at `c630152` with no open PRs. Three PRs merged after Phase 8 was written up
below:
**PR #35** (M10 Wave 2 Phase 8 — correctness and polish, the branch this
file previously described as "open awaiting merge"), **PR #44** (a KI backlog
pass: closed KI-6, KI-20, KI-29 and KI-31, re-scoped KI-28, and fixed the
`minimal-check-subset` skill), and **PR #45** (hardened the
`/cleanup-orphans` skill after its first real run). **The next work is
opening Phase 8b's PR** — see "Phase 8b" under "In flight" and "Next action"
below. One of Phase 8b's five design items, the sync-failure banner (Task
8b.4), was **deliberately not shipped** — see that section and **KI-36**.

**CI on `main` at `c630152` is green** — run `32785947175`, all four jobs:
`static-checks`, `unit-tests`, `integration-e2e` and `migrate-production`.
That is the verified state of `main` as of this entry; nothing else in this
session was re-run locally.

**Previously (2026-08-24): M10 Wave 2 Phase 8 (correctness and polish)
implemented on `claude/m10-wave2-phase8-polish-nuhu7q`, branched from `main`
at `39ccea1` (post-PR #32 and PR #33). All seven tasks done, each its own
commit, in phase-file order; merged to `main` via PR #35 — see "Phase 8"
under "In flight" below for the full record, including a from-scratch local
environment setup that let that session get a genuine local
`test:e2e:ci-like` signal for the first time since KI-33 started blocking it
(Phase 7), and a real (not fabricated) fix for KI-18, the accent-collision
bug that phase exists to close.**

**Previously (2026-08-24): a dev-speed and quality pass landed on
`claude/dev-speed-quality-57205c`, merged to `main` via PR #36. It does not
move any milestone gate; it changes how the work gets verified.** Six things,
all evidence-driven rather than speculative:

1. **KI-33 fixed** — `unscheduledRack.ts` → `fitIntoDay.ts` (and its test).
   This is the big one: `next build` now **succeeds on macOS**, so
   `pnpm --filter web test:e2e:ci-like` is runnable on a dev machine again
   rather than being blocked outright, and the unit suite is 668/668 instead
   of 640/665. Local verification had degraded to the point where CI was the
   only trustworthy signal — PR #32 took four CI runs to land, two of them red.
2. **CodeRabbit polling documented and configured.** CodeRabbit is a
   *registered status check*, so `gh pr checks <n> --watch --fail-fast` blocks
   on it — no session had ever used `--watch`, and hand-polling was a real
   time sink (its verdict lands 2-11 min after the PR opens, vs ~30s for its
   summary comment). Also adds `.coderabbit.yaml`: chill profile, `docs/**`
   and generated SQL filtered out, and per-path instructions pointing it at
   this repo's actual invariants. It stays a required check.
3. **A PR template** (`.github/PULL_REQUEST_TEMPLATE.md`) carrying the DoD
   checklist plus a **Verification actually performed** section with an
   explicit "Not run, and why" line. Phases 5, 6 and 3 each shipped with a
   verification step skipped and nothing on the PR recording it; Phase 7 ran
   the browser walk and immediately found a crash. This makes a skip visible.
4. **A PostToolUse typecheck hook** — typechecks only the package owning each
   edited `.ts`/`.tsx` file (~1.6s warm, incremental), same narrowing rules as
   `minimal-check-subset`, including the contracts hard-exception.
5. **Three repo subagents** in `.claude/agents/` — `phase-implementer`,
   `phase-verifier` (runs the check subset *and* the browser walk against the
   PR's Vercel preview, so it works from a container with no local infra), and
   `ki-fixer` (one KI each, parallel-safe since KIs are independent of the
   phase chain).
6. **CI uploads Playwright traces on failure.** `trace: "on-first-retry"` was
   already set, so traces were being generated and thrown away; remote e2e
   failures had to be diagnosed from job logs. Also: the SessionStart hook now
   reconciles deps on *local* sessions too — worktrees don't share
   `node_modules`, and one was found 16 days stale, failing typecheck with
   TS2307s that read like real type errors.

**Previously (2026-08-24): M10 Wave 2 Phase 7 (add-stop and new-trip forms)
implemented on `claude/m10-wave2-phase7-forms`, branched from `main` at
`624a0db` (post-PR #31); merged via PR #32.** Both tasks' own manual browser
checks were actually performed that session — a real interactive browser,
unlike Phases 5/6 — and that walkthrough caught and fixed a real crash bug
(`RangeError: Invalid time value`) in the wizard's date arithmetic that no
unit test surfaced. CI then caught two more, neither visible from a local
run blocked by KI-33: a wizard navigation race CodeRabbit flagged
(dates/budget/currency dispatched fire-and-forget, then navigated regardless
of whether they'd confirmed — fixed with an awaited, retry-safe submit), and
a broader one CI found on its own — "Create empty" had started navigating
straight to the new trip like the full wizard does, when it's supposed to
keep the old single-field dialog's actual behavior (stay, refresh the list);
nine pre-Phase-7 e2e specs are built on exactly that and all failed until it
was fixed. Also filed **KI-33**, a pre-existing (Phase 3) filesystem-casing
bug that blocks `next build` outright on macOS/Windows and degrades local
test signal, though not CI. Since that update, PR #32 merged and a small
follow-up PR #33 removed the "or drop a stop from Unscheduled" hint from day
columns.

**Previously (2026-08-24): M10 Wave 2 Phase 6 (growing the trip) merged to
`main` via PR #30**; see "Phase 6" under "In flight" below. It closes **KI-30** and
files **KI-31** and **KI-32** rather than absorbing them. Its Step 4 (the manual
browser walk) was not performed — no interactive browser in the container — but
the phase's gate is scripted as `e2e/m10-growth.spec.ts` instead, which is a
narrower claim than a human walking it; the PR's Vercel preview is how that gets
genuinely ticked.

**Previously (2026-08-23): a design sync landed in the repo, was reviewed and
routed, and Mitchell's calls are recorded — see "Design sync" below. No code
changed. **It does widen M10's gate**, by two approved phases (8b and 1b), and
it adds **M15 Front door** between M10 and M9 (ADR-021). Same day: a test-suite overhaul, Phases 0-4, landed as an
off-roadmap insert — see "Where we are" below; does not move M10's gate.
Same day: M10 Wave 2 Phase 3 — the unscheduled rack — landed, PR #26; it had
been built and verified since 2026-08-22 but was never opened as a PR, see
"Known gap" below for how that happened. KI-26 and KI-27, both filed during
Phase 4's CI diagnosis, are closed in the same PR. Also same day: M10 Wave 2
Phase 5 — overlap warnings — **merged to `main` via PR #29**; the phase file's
Step 4, the manual browser pass, is the one thing still not done. Two known issues
were filed from that PR's review rather than absorbed — KI-29 and KI-30. See
"In flight" below.)**

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

**Current milestone is M10, Wave 2.** Nothing else starts until it passes.
Order (amended 2026-08-23 by ADR-021, which inserts M15 before M9):
`M8 ✓ → [Phase 1 gate review ✓] → M10 (Wave 2, now) → M15 → M9 → M11 → …`.

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

**2026-08-23: a test-suite overhaul, Phases 0-4, landed as a second
deliberate off-roadmap insert, ahead of M10 Wave 2 Phase 5.** Per
`AGENTS.md`'s scope-creep rule, called out rather than silently absorbed —
this is that call-out. **This does not reopen or move M10's gate** — M10
Wave 2 Phase 5 remains exactly the resume-from-here point (below).

The driving need: the `apps/web` unit suite had grown to 95 files / 569
tests spending more wall time constructing jsdom worlds than running
assertions (`environment` 58.7s vs `tests` 22.5s on a 43.1s run), plus four
open test-reliability known issues (KI-13, KI-19, KI-21, KI-25) making a
red run untrustworthy — exactly the condition that let KI-1 (a real
correctness bug) hide behind a "probably flake" label for two weeks. The
full plan, evidence, and phase-by-phase execution record live in
`docs/plans/2026-08-23-test-suite-overhaul.md`,
`docs/testing-inventory.md` (the keep/cut inventory Phase 5 will execute),
and `docs/testing-baseline.md` (before/after numbers for every phase).

**Phases 0-4 delivered:** a measured baseline (`docs/testing-baseline.md`);
an environment split cutting the unit suite's `environment` time 33.5%
(88.29s → 58.73s median) with zero test content changed; `@tc/factories`
(ADR-020), a new workspace package collapsing four independent test-data
vocabularies (`src/mocks/fixtures.ts`, e2e's `createMappedTrip`, `db-seed`,
and every component test's own hand-built literals) into one, typed
against `@tc/contracts`, with rollups computed via `@tc/domain`'s
`rollupCosts` rather than kept consistent by hand; e2e sign-in-once via
Playwright storageState (24 `signInAsDevUser` calls down to 1); a
narrow-viewport gate project (`e2e/responsive.spec.ts`); a rewritten
`dragCardTo` that removes KI-21's auto-scroll race instead of widening its
timing window; and an unauthenticated `/api/health/ai-mode` endpoint plus
Playwright `globalSetup` that makes the simulated-AI e2e guarantee
(KI-25) unconditional. **KI-19, KI-21, and KI-25 are closed** in
`docs/known-issues.md`. **KI-13 is closed as no longer reproducible**,
explicitly not as root-caused — see its entry for the honest scope of what
this session's reproduction attempts did and didn't establish.

**Phases 5-7 (pruning, de-brittling, testing guidelines) are deliberately
not part of this insert** — they are gated on M10 Wave 2's own gate closing,
because M10 Wave 2 Phases 5-8 are about to rewrite eight of the components
whose tests those phases would otherwise prune or rewrite twice
(`TimelineLens`, `ActivityEditor`, `DayChips`, `CalendarLens`, `TripHeader`,
`NextTripHero`, `Board`/`app/page.tsx` — see the plan's Sequencing section
for the full collision table). Resume them once M10 Wave 2 Phase 9's gate
closes and this branch is merged to `main`; re-run the Phase 0 inventory
against the post-M10 tree first, since Wave 2 Phases 5-8 will have added
tests of their own that the current inventory doesn't know about.

## Design sync (2026-08-23) — reviewed and routed, nothing built

A design bundle is committed in-repo for the first time, at
`.design-sync/handoff/`: `design/Trip Planner Redesign.dc.html` (3,524 lines),
`SPEC.md`, `DRIFT.md`, and a Japan seed export. It arrived in two commits —
`8c2d11e` (2026-08-22, the bundle) and `e0964bc` (2026-08-23, +401 lines: the
Notebook design). **This changes no code and does not reopen or move M10's
gate.** The full reconciliation, the drift questions, and the per-item milestone
routing are in `docs/design-feedback/2026-08-23-design-sync-review.md`.

Three things a fresh session needs from it:

1. **The design source of truth moved.** It is the in-repo file above. The
   `~/Downloads/design_handoff_update/` path this file and the M10 plan used to
   name exists in no session — generations 1-3 (1,412 / 2,048 / 2,623) are
   unreadable, so generation-diffing is over. Reconcile design against *code*,
   with `apps/web/src/lib/preview-registry.ts` as the spine for "not built yet".
2. **The in-repo file is newer than what M10 Wave 2's phases were written
   against**, and most of what it adds is **not M10's**. Net-new: a landing
   page, sign-in/sign-up screens, a first-run screen, a header account menu, a
   full Notebook redesign, and the product renamed **Caesura**. Routing:
   **M15 Front door** (proposed) takes landing/auth/first-run/account menu;
   **M14** takes the Notebook redesign and needs a **repeaters ADR** before it
   opens; **M11** takes the landing page's "Look around a real trip" CTA (it
   needs unauthenticated read of a real trip); `TripSummary.startDate` is its
   own reviewed contract step. **Do not widen an M10 phase to absorb any of it.**
3. **M10's gate got two approved additions, and M15 got approved** (Mitchell,
   2026-08-23 — the review's §8 carries all the calls):
   - **Phase 8b** (`docs/plans/M10-delta/phase-8b-design-sync.md`) — the Caesura
     rename, a working **sign out** (nothing in `apps/web/src` calls the
     `signOut` that `server/auth.ts` exports today), a three-state save
     indicator, the sync-failure banner, calendar month blocks, and **the trip
     start picked with the end derived** (Task 8b.6, after Phase 6). Runs after
     Phase 8.
   - **Phase 1b** (`docs/plans/M10-delta/phase-1b-header-scope.md`) — the header
     adopts `SPEC.md` §1's focus-scope model, as an explicit revisit of the
     merged Phase 1. Runs after Phase 7 and 8b. `AppHeader` stays a server
     component; the actions portal into a client slot.
   - Both recorded as gate-scope amendments in
     `docs/milestones/M10-visual-craft.md`. **Phase 9's checklist now covers
     them.** Phase order to the gate: 5, 6, 7, 8, **8b**, **1b**, 9.
   - **M15 Front door** is approved and executes **after M10's gate, before M9**
     (**ADR-021**, `docs/milestones/M15-front-door.md`).

   - **Trip dates are start-only** (Mitchell, 2026-08-23): *"the end date will
     always be start date + number of days in trip"*. Smaller than it looked —
     `endDate` is stored nowhere (not on `TripState`, not on `TripDetail`) and
     `TripHeader.tsx:228` already derives it from the plan's last day, so this
     is a UI-only diff with **no contract, command or domain change**. That is
     why it sits inside M10 as Task 8b.6 rather than after the gate. Phase 7's
     wizard step 2 loses its "Leave" input in the same decision, and `TODO.md`'s
     end-date-drift item is closed — its diagnosis was wrong, there was never a
     stored field to drift.

   **Two questions stay open**, both carried into M15's milestone file: whether
   the one-field first-run screen is meant to differ from Phase 7's four-step
   wizard, and whether the landing copy may sell M11/M12 before they exist.

## In flight

**M10 Wave 2 — Phases 0, 1, 2, 3, 4 and 5 all merged to `main`** (Phase 5 via
PR #29, 2026-08-23; its branch is deleted). Phase 3
(the unscheduled rack) landed 2026-08-23 via PR #26, once `main` was merged
into its branch and everything re-verified — see "Known gap: Phase 3 built but
unmerged (RESOLVED 2026-08-23)" below for the full story and what the
landing PR did. Phases 6 and 7, which depend on Phase 3's code being on
`main` rather than just on a branch, are now unblocked. Phase 8 remains
independent and untouched; Phase 5 is described in its own section below.

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
because CI actually runs against a production build). Both closed
2026-08-23 in the Phase 3 landing PR — see `docs/known-issues.md`'s
Resolved section for what each turned out to be and what fixed it.

### Known gap: Phase 3 built but unmerged (RESOLVED 2026-08-23, PR #26)

`claude/m10-phase-3-rack` (also pushed to origin) had Phase 3 fully done:
`lib/time.ts` (`toMinutes`/`toTimeString`, moved out of `TimelineLens.tsx`),
`unscheduledRack.ts` (`fitIntoDay`), `UnscheduledRack.tsx` (the sticky
bottom drawer, mounted once in `TripBoardScreen` outside the lens switch),
`board/resolveDrop.ts` and `trip/rackDisclosure.ts` (pure logic extracted
for real unit coverage, since jsdom has no `DataTransfer`/`DragEvent`), a
dedicated `e2e/m10-unscheduled-rack.spec.ts`, and selector updates to five
other e2e specs. Verified on that branch 2026-08-22 by walking the exit
checklist in a real browser, plus unit/int/e2e all green, but **never opened
as a PR** — discovered late, by a fresh session's own stale task list still
claiming Phase 3 "done" days after the fact. See `AGENTS.md`'s Workstreams
section for the process rule this added to prevent a repeat.

**Landed 2026-08-23 via PR #26.** `main` was merged into the branch;
conflicts turned out to be in `Board.tsx` (Phase 3's removal of the old
full-width Backlog column superseded Phase 4's untouched copy — not an
additive merge, kept Phase 3's side), `preview-registry.ts` (additive — kept
both phases' registry entries), and `STATUS.md` itself (kept `main`'s more
current narrative) — **not** `TimelineLens.tsx`, which auto-merged cleanly
despite both phases touching it (Phase 3's `lib/time.ts` extraction, Phase
4's per-day cost display both survived). Re-verified after merge: unit
(568/568), int (79/79, real Postgres), and the full e2e suite against a
production build with `CI=true` per KI-27 — 14/15, with `m1-board.spec.ts`'s
drag-to-day-2 assertion confirmed (via a control run against the original,
unmerged `claude/m10-phase-3-rack` branch) to fail identically there too —
pre-existing, unrelated to the merge, same KI-21 flakiness class.

### Phase 5 (overlap warnings) — merged to `main` 2026-08-23 via PR #29

Seven commits, based on `main` at `fcb22b5`; the branch is deleted. The
first three were the phase itself; the last four came out of PR #29's review:

- `d7a274b` — **Phase 5 proper.** New
  `apps/web/src/components/lenses/overlapData.ts` and `OverlapWarning.tsx`;
  `TimelineLens.tsx` renders the design's inline, never-blocking warning inside
  the existing `92px 1fr` grid, attached to the later-starting stop — which has
  to be worked out from the two `timeWindow`s, because a `time-overlap`
  conflict's `subjects` is sorted by activityId, not by time. The one-click fix
  moves the later stop to begin when the earlier one ends, keeping its
  duration; Dismiss sends `DismissConflict` for the pair's id and changes no
  trip data. Day headers get an overlap count badge, day columns the compact
  chip. `lib/time.ts` gained `toClockLabel`, and `formatDuration` was hoisted in
  from `TimelineLens` rather than copied. **Zero diff to `packages/`** —
  presentational only, as the phase requires.
- `4060a1e` — the phase file's "a time-overlap shows the rich warning and not
  also a bare triangle" rule had only been applied in `TimelineLens`, so
  day-column cards rendered both the generic conflict badge and the new chip.
  The exclusion is now one shared helper, `badgeableConflictSubjects()` in
  `overlapData.ts`, called from both `TimelineLens` and `Board`.
  `board.test.tsx`'s badge coverage split into two tests so non-overlap badging
  stays independently proven.
- `2b97b80` — `apps/web/e2e/m1-board.spec.ts`'s three day-column assertions
  retargeted from bare `getByText` substrings to the card-scoped locator the
  spec already used elsewhere. The chip renders the *other* stop's title inside
  the same day column, so the old locators passed only by assertion ordering —
  one line-reorder from a strict-mode violation. Defensive hardening, not a bug
  fix: both the old and the new locators resolve uniquely today.

Verified on the branch: unit 595/595 (98 files); `pnpm --filter web typecheck`
clean; `pnpm --filter web lint` clean (note that is `eslint src` only, so it
does **not** cover `e2e/`); `node scripts/check-color-wall.mjs` OK; and the
full e2e suite run three times against a production build
(`test:e2e:ci-like`, per KI-27) with a locally-provisioned Postgres — 21/21
clean twice, plus one earlier run with a single KI-28-class flake on
`m8-make-it-real.spec.ts` that passed on retry and touches no board code.

**Not done: Step 4 of the phase file — the manual browser walk of the exit
checklist.** There is no interactive browser in this container, so that step
was skipped outright, not approximated. Phase 5's exit checklist otherwise
holds, on the evidence of the runs above: the warning renders on the later
stop, the stated duration is the true intersection, the fix keeps duration and
never blocks, dismissal is per pair and changes no trip data, the count badge
and the compact chip both appear, and the `packages/` diff is empty.

Per `AGENTS.md`'s Workstreams rule, a phase branch is **not "done" until its
PR is open** — the same rule Phase 3's landing gap added; see "Known gap"
above. **PR #29 was opened 2026-08-23** and CI went green on it (all three
jobs; `migrate-production` skipped, as it is on any PR).

**What the review then found.** CodeRabbit raised two Major findings, both
verified against the code before acting rather than taken at face value, and
both real:

- `f517e07` — this section, recording the phase before the PR was opened.
- `69c93c8` — **KI-29 filed**, not fixed. A stop can be the later half of more
  than one crossing pair, and `Board`'s `overlapsByActivity` keys one `Overlap`
  per `laterActivityId`, so the rest are dropped; because `4060a1e` also
  stopped badging time-overlap conflicts, the dropped pair now has no
  day-column surface at all. Bounded — the conflict banner and the Timeline
  lens both still reach every conflict — but real. Not folded in because what a
  card shows when a stop has N overlaps is a design question and the handoff
  specifies a single chip; it goes to the Phase 9 gate with three options
  ranked by cost.
- `37f2c13` — **the truncation fix.** `toTimeString` clamps to 23:59, so the
  repair silently shortened any move running past midnight (a 30-minute stop
  repaired to 23:45 was dispatched as 23:45–23:59, a 14-minute stop) — which
  breaks the phase's own "keeping its duration". `Overlap` now carries
  `suggestedEnd: string | null`, computed once in `overlapData.ts`; when it is
  null the fix is simply not offered, and `fixOverlap` guards too, so the
  missing button and the missing command are one rule. `DAY_END_MIN` moved into
  `lib/time.ts` beside the clamp it derives from, and `unscheduledRack.ts`'s
  identical private copy now points at it. Still zero diff to `packages/`.
- `f718e45` — **KI-30 filed**, not fixed. The same clamp has a second,
  pre-existing instance: `nextSlot()` prefills the add-a-stop editor with start
  and end both clamped to 23:59 on a day already running to midnight, which
  `TimeWindow`'s `start < end` refinement rejects. The honest fix is an audit of
  every arithmetic caller of `toTimeString` plus a decision about what the
  affordance should do at the end of a day — Phase 6 territory, since it
  rewrites those rows.

Re-verified after the fix: unit **600/600** (98 files), typecheck, lint and the
colour wall clean, and the full e2e suite **21/21** against a production build.
Both review threads are answered and resolved.

### Phase 6 (growing the trip) — merged to `main` 2026-08-24 via PR #30

Two commits on `claude/m10-wave2-phase6-8s0713`, branched from `main` at
`df1b05f` (post-PR #29). Presentational only: **zero diff to `packages/` and to
`apps/web/src/server`**, no new commands, no new contract fields, no new
`<Preview>` registry entries.

- `5ce3759` — **the Timeline half.** New `components/trip/EndOfTrip.tsx` (the
  design's end-of-trip block: a real "Add a day", plus an inert "Add a saved
  day" and three Playbook shortcuts inside the Wave-1 `insert-playbook`
  Preview). `TimelineLens` renders it after the last day, gives every day a
  dashed add-a-stop row, and renders an empty day honestly in both the day's
  route line and its body. `AddDay` is raised through the **existing**
  `onCommand` seam `ScheduleLens` already forwards, reaching the same
  `dispatch` the Board lens's `onAddDay` uses — no new prop. The appended day
  is scrolled to via the focus effect the lens already owned.
- `9540d55` — **the Board / Calendar / Map half**, plus the gate script. The
  trailing dashed "One more day?" column replaces the loose `+ Add day`
  button; `Column` gains the "or drop a stop from Unscheduled" hint; Calendar
  and Map get their empty-day copy. `MapDay` gained an `isEmpty` flag because
  the copy table gives the map's two surfaces **different** strings for the
  same empty day (rail "Nothing planned yet", focus card "No stops yet"), and
  one shared pre-rendered `flagText` could not serve both.

**KI-30 is closed here** — it was Phase 6's to fix and the entry named the two
things it wanted. The audit: `overlapData.ts`'s `repairedEnd()` was already
guarded (and is the pattern this fix copies); `unscheduledRack.ts`'s two
`toTimeString` calls are safe by construction and unchanged; `nextSlot` was the
bug. The decision: at the end of a day the add affordance is **withheld, not
degraded** — a shorter real slot is offered wherever one exists (a day with 29
minutes left gets those 29 minutes), and only a day already running to 23:59
withholds, mirroring how a null `suggestedEnd` makes `OverlapWarning` render no
fix button. Full reasoning in `docs/known-issues.md`'s Resolved section.

**Two findings were filed rather than absorbed**, per `AGENTS.md`:
**KI-31** (the Preview registry's orphan guard is structurally unable to see
that `add-saved-day` is orphaned, because its only "usage" is the unrendered
`AddSavedDayButton.tsx` the phase file explicitly says to keep) and **KI-32**
(the container image ships Chromium build 1194 while the pinned
`@playwright/test` wants 1228 — local e2e needs a workaround; **CI is
unaffected** and remains the authoritative signal).

**Deliberately not built:** the phase file's Step 3 bullet 4, the gap-fill row
(`Add something at {time}`). It hangs off Phase 8 Task 8.1's 150-minute
"Nothing planned" threshold, which has not landed, and the phase file itself
says to skip it in that case rather than invent a second threshold.

**Not done: Step 4, the manual browser walk** — same reason as Phase 5, no
interactive browser in this container. Instead the phase's own gate
("adding a day appends it, scrolls to it, and it renders correctly in Timeline,
Day columns, Calendar and Map") is scripted end to end as
`apps/web/e2e/m10-growth.spec.ts`, running against a production build. That is
a real check but a narrower one than a human walking the checklist, and it is
recorded as such rather than ticked.

Verified on the branch: `pnpm --filter web typecheck` clean; `pnpm --filter web
lint` clean (note that is `eslint src` only, so it does **not** cover `e2e/`);
`node scripts/check-color-wall.mjs` OK (283 files); unit **646/646** (99 files,
up from 600/98); and the full e2e suite **22/22** against a production build
(`test:e2e:ci-like`, per KI-27) with a locally-provisioned Postgres. KI-28 did
not fire. All copy was verified byte-identical to the phase file's table with
`grep -F`, not by eye.

### Phase 7 (add-stop and new-trip forms) — merged to `main` 2026-08-24 via PR #32 (plus follow-up PR #33)

Two tasks, two commits, on a branch cut from `main` at `624a0db` (post-PR #31).
**Zero diff to `packages/` or `apps/web/src/server`** — the phase's own
presentational-only boundary — though the forms this phase rebuilds do
dispatch real commands (`AddActivity`, `UpdateActivity`, `SetTripDates`,
`SetTripBudget`, `SetTripCurrency`), so "presentational" describes the diff's
scope, not the feature's effect (CodeRabbit, PR #32, on an earlier draft of
this section that conflated the two). Delegated to two sequential
subagents (Task 7.1 then Task 7.2, same working tree, never concurrent), each
briefed on the phase file plus the two known traps below; both reviewed by the
orchestrating session afterward rather than trusted on the subagent's own
report.

- `61de98c` — **Task 7.1, the add-stop sheet.** `ActivityEditor.tsx` rebuilt
  to the design's field order: "What or where" (title, relabeled), a
  Preview'd suggested-matches shell (`add-stop-suggestions`, M9), the
  existing `LocationInput`, a 3-up Day/Start/How-long grid (new
  `activityDuration.ts`: `DURATION_OPTIONS`, `closestDurationLabel` for the
  prefill-duration reverse mapping), a live `Banner variant="success"`
  computed via `fitIntoDay`, Cost (`MoneyInput`, gained an optional
  `placeholder` prop), a Preview'd "Who is in" shell (`add-stop-who`, M13),
  Notes, and the hairline footer. The nested `Card` is gone — the `Sheet` is
  the surface. Edit mode swaps "How long" for a real "End time" input and
  disables the Day select (`UpdateActivity` carries no `dayId`; cross-day
  moves stay `MoveActivity`'s job). `ActivityFormValue` gained a `dayId`
  field so the form's own Day selection — not just the `openCreate()`
  prefill — decides where a new stop lands.
  **`TimelineLens.tsx` and `EditorHost.tsx` are untouched** (confirmed via
  `git diff`) — the reverse mapping from a prefilled `TimeWindow` (e.g.
  `nextSlot()`'s output) to an initial Start + closest-duration selection
  happens entirely inside `ActivityEditor`, exactly as briefed, so
  TimelineLens's two `openCreate({ dayId, timeWindow: nextSlot(row) })` call
  sites needed no changes.
- `1e8ac07` — **Task 7.2, the new-trip wizard.** New
  `components/home/NewTripWizard.tsx`, a `Sheet`-hosted 4-step wizard (Where
  / When / Who & Money / Shape — "Who" and "Money" share one step, per the
  phase file's own table). Step 1: real trip-name input, Preview'd
  destination chips and Playbook panel. Step 2: real Arrive date + four real
  length chips (Long weekend=4, A week=7, 10 days=10, 2 weeks=14) computing
  the end date locally; **no Leave/end-date input exists anywhere** (the
  2026-08-23 amendment). Step 3: Preview'd invite list + real budget/currency,
  staged locally and dispatched only at final submit (can't dispatch against
  a `tripId` that doesn't exist yet). Step 4: Preview'd pace/tags and
  assistant-draft panel. Sequence on submit matches the plan exactly:
  `createTrip({ name })` → `SetTripDates`/`SetTripBudget`/`SetTripCurrency`
  against the returned `tripId`, each only if the user actually touched that
  field → navigate to the new trip. "Create empty" stays reachable from step
  1, dispatching only `CreateTrip`. `apiClient.ts` gained an exported
  `createTrip` helper; `app/page.tsx`'s old single-field `Dialog` is gone,
  replaced by `<NewTripWizard>`.

**The `Longer` chip question** (the phase file flags it as a value the design
never specifies) **was put to Mitchell before Task 7.2 started, not guessed:**
ship the four specified chips as real, wrap `Longer` in an inert
`<Preview size="compact">` badge with no day count and no click handler
(`wizard-longer-chip`, M11). That is what shipped.

**A real bug, found only by the manual browser check, not by either
subagent's test run:** walking the wizard's Step 2 in a real browser (this
session had one — see below) crashed with `RangeError: Invalid time value`
while typing into the Arrive date field with a length chip already selected.
Root cause: a native `<input type="date">` briefly emits a non-empty,
not-yet-complete value while a segment is mid-edit; `addDaysIso()` parsed
that into an Invalid Date and `toISOString()` threw rather than returning
garbage. Fixed in `4a383ee`: both the live banner and the final
`SetTripDates` dispatch now gate on a `YYYY-MM-DD` regex before treating
`arrive` as usable. Re-verified in the browser (identical keystroke sequence,
no crash, correct derived date range) and the full unit suite re-run with no
*additional* failures beyond KI-33's pre-existing 25 (CodeRabbit, PR #32: the
first draft of this line said "re-run clean," which reads as contradicting
the 640/665 figure a few paragraphs below — both describe the same run,
neither is wrong, but only this phrasing says so without a reader having to
reconcile the two). This is exactly the "a green suite won't tell you" class of bug
`AGENTS.md`'s testing philosophy warns about — neither given nor
subagent-written test happened to type a date one keystroke at a time with a
chip already selected.

**KI-33 filed, not fixed** (`docs/known-issues.md`): `UnscheduledRack.tsx`
and `unscheduledRack.ts` (both Phase 3, unmodified by Phase 7) collide by
name on a case-insensitive filesystem. Confirmed pre-existing via a
throwaway worktree against `main` at `624a0db` before either Phase 7 task
started. Locally this breaks 25 unit tests (`TripBoardScreen.test.tsx`,
`UnscheduledRack.test.tsx`) **and blocks `next build` outright** — meaning
`pnpm --filter web test:e2e:ci-like` could not be run in this session at all,
not just degraded. CI (case-sensitive) is unaffected and remains the
authoritative signal for both the unit suite and e2e, same reasoning as
KI-27/KI-32. The fix is a one-file rename touching Phase 3's files, out of
Phase 7's scope; flagged for priority pickup given it now blocks building the
app, not just two test files.

**Manual browser checks — both actually performed, not skipped.** Unlike
Phases 5 and 6, this session had a real interactive browser (Phase
5/6's "no interactive browser in this container" note does not apply
universally — it was true of those specific sessions/environments, not a
standing constraint). Walked both: (1) Task 7.1's checklist — at 1280px with
the assistant rail open, the Add-a-stop sheet opens fully visible and usable
on top of it; created a stop with Day 3 / Start 09:00 / How long 1.5 hours
and confirmed it landed on Day 3 at 09:00–10:30; opened it in edit mode and
confirmed the End-time field and disabled Day select. (2) Task 7.2's wizard
walk — all 4 steps, length chip + Arrive date, budget + currency, submitted
via "Create trip", landed on the new trip's page with the correct derived
date range (Sat Oct 3 – Mon Oct 12, 10 days) and budget ($2,500.00) applied.
Both used `next dev` (Turbopack), not a production build — KI-33 blocks
`next build` on this machine, so a genuine production-mode manual check
wasn't possible here; CI's own build remains the production-mode signal.

Verified on the branch before the first push:
`pnpm --filter web typecheck` — clean except KI-33's pre-existing casing
error; `pnpm --filter web lint` — clean; `node scripts/check-color-wall.mjs`
— clean (288 files); `pnpm --filter web test` — **640/665**, the 25 failures
are exactly KI-33's two files, confirmed by name, nothing else newly broken.
`pnpm --filter web test:e2e:ci-like` **could not be run locally** — KI-33
blocks the `pnpm build` step it depends on; CI is authoritative for e2e on
this PR.

**Two rounds of fixes followed, once PR #32 opened and CI ran for real —
exactly the local-vs-CI gap KI-33 predicted, playing out concretely:**

**Round 1 (CI's first run, before any human or CodeRabbit review):**
`unit-tests` and `integration-e2e` both failed, `static-checks` passed. Root
cause: Task 7.1's own new UI (relabelled fields, a renamed submit button)
was never checked against the *existing* e2e suite and unit tests that
predate Phase 7 — TripBoardScreen.test.tsx (2 tests) and nine e2e specs
(m1-board, m2-history, m3-place-and-time, m4-money-and-lenses, m6-optimistic
×2, m7-solo-delight ×3, m8-make-it-real, smoke) all still drove the old
"Activity title"/"Start time"/"End time"/"Save" shape or the old
single-field "Trip name" → "Create trip" dialog. Investigating this also
surfaced a real, separate regression: Task 7.1's Day-select default had
started falling back to the trip's first day whenever the sheet opened with
no prefill at all — but that's exactly TripHeader's own bare "Add stop"
trigger, which `AGENTS.md`'s "real" feature list and those same e2e specs
document as creating an **unscheduled** stop. Fixed (commits `2dda3b6`,
`003c209`, `00aea06`): relabelled every stale test assertion, restored the
create-unscheduled default with a new regression test, and along the way
addressed all eight of CodeRabbit's review findings on the same push
(logged in the commit body and replied to on each thread) — the two
substantive ones being the wizard's dates/budget/currency dispatch running
fire-and-forget with no error surfaced on failure (now awaited, checked,
and retry-safe against minting a duplicate trip) and the availability
Banner describing a different window than what actually gets saved (now
computed from the real start+duration).

**Round 2 (after Round 1's push):** `unit-tests`, `static-checks` and
`CodeRabbit` all went green, but `integration-e2e` still failed — now on 12
specs, including four (`m10-growth`, `m10-map-rail`,
`m10-unscheduled-rack`, `responsive`) that don't touch the wizard or
activity editor at all and had passed in the very first CI run. Root cause:
Round 1's relabelling fixed the *selectors*, but a separate bug in the
wizard's own navigation meant `NewTripWizard`'s `onCreated` had started
firing on **every** successful create, including "Create empty" — which the
phase doc frames as the old single-field dialog's exact escape hatch, and
that dialog never navigated (it closed and left the user on the trip list).
Nine specs click "Create empty" (or its pre-Phase-7 equivalent) and then
click the new trip's own list-card link to navigate there — a version that
navigates first leaves the page (and that link) before the click ever runs.
The four unrelated specs almost certainly failed as collateral: nine
30s-timeout-plus-retry failures add roughly 9 minutes to a single-worker,
22-test sequential run, which is consistent with the *whole job* running
long enough to affect specs queued after them, not a defect in those specs
themselves — supported by integration-e2e dropping from ~15 minutes to
under 5 once this was fixed. Fixed in `36944a2`: `onCreated` now carries a
`{ navigate }` flag, true only for the full wizard's final "Create trip"
step (matching the phase doc's own "create... apply dates and budget...
then navigate" sequence); "Create empty" reloads the trip list and stays,
exactly reproducing the dialog it replaced. New `page.test.tsx` coverage
locks in the no-navigate path.

**Final state, all four required jobs green:** `unit-tests` (2m32s),
`static-checks` (1m2s), `integration-e2e` (4m47s, 22/22), `CodeRabbit`
(no further findings — its reply on the reworded "presentational" line
confirmed the correction). `pnpm --filter web test` locally: **644/669**,
the same 25 KI-33 failures and nothing else, confirmed identical across
every round above. `migrate-production` correctly skips on a PR (only runs
on merge to `main`).

### Phase 8 (correctness and polish) — merged to `main` 2026-08-24 via PR #35

Seven independent tasks, seven commits, on a branch cut from `main` at
`39ccea1` (post-PR #32/#33 — confirmed no stray `claude/*` branch already
existed for this phase, per `AGENTS.md`'s Workstreams check). Executed
sequentially in one working tree via subagent-driven-development (one
subagent per task, never concurrent, each reviewed by the orchestrating
session before the next started), per `AGENTS.md`'s delegation default and
the phase file's own "keep it sequential" instruction.

- `ef59a8e` — **Task 8.1.** `TimelineLens.tsx`'s `Leg` no longer invents a
  straight-line distance (`haversineKm` stays in `lib/geo.ts` for Phase 2's
  map, just dropped from the timeline's own import) or a 30-minute "Long gap"
  pill. Copy is now `{duration} until next stop` / `Back to back` / an
  additional `Nothing planned` pill at 150+ minutes, matching the handoff
  verbatim. `formatDuration` (`lib/time.ts`, shared by the leg line, the
  day-header "out" total, and `OverlapWarning`) now emits space-separated
  units (`"1 h 15 m"`) to match the design copy, adjusted in place rather
  than adding a second formatter — this rippled into three existing tests'
  string assertions.
- `0ad8db2` — **Task 8.2, KI-18.** The actual bug this phase exists to fix.
  `lib/dayAccent.ts`'s `dayAccentFor` (one city at a time, hash-only, no
  collision handling) is replaced by `dayAccents(cities)`, resolving a whole
  trip's cities at once via a two-pass hash + linear-probe over the five
  semantic families (sorted distinct cities claim home buckets first,
  collisions probe forward and wrap, more than 5 distinct cities degrades to
  the raw hash rather than throwing), with an explicit `"neutral"` family for
  a day with no known city rather than a hashed-in real one. Every caller
  updated: five "one trip's days together" callers (`DayChips`,
  `TimelineLens`, `Board`, `CalendarLens`, `mapRailData`) now batch one
  `dayAccents()` call per trip and index by day, which is what actually
  enables cross-day probing; three "one independent item" callers
  (`TripCard`, `PlaybookCard`, `PlaybooksStrip`, which color unrelated cards
  in a grid, not days within one trip) call `dayAccents([x])[0]` unchanged in
  behavior. `neutral` added to 9 static `Record<AccentFamily, string>` maps
  across 10 files (`bg-moss`/`text-slate`/`bg-slate`, all existing tokens).
  `dayAccent.test.ts` replaced wholesale — the old suite's "spreads distinct
  cities across families" assertion passed at 7-of-13 real-city collisions,
  which is exactly the false-confidence problem the entry called out; the
  new suite asserts Tokyo/Kyoto/Osaka land on three distinct families, same
  city same family throughout a trip, order-independence, and no-throw past
  5 distinct cities. **KI-18 moved to Resolved.**
- `11dfbd0` — **Task 8.3.** `DayChips.tsx`'s combined `"5 Rochester"` string
  split into two separately-queryable elements (a mono date number, a
  truncated city span), and the day-of-week label now uses the day's real
  ink colour (a new `INK_TEXT` map, same pattern as `TimelineLens`/
  `KeepDayFlag`) instead of a hardcoded `text-ink`.
- `0310eaf` — **Task 8.4.** `Preview`'s badge no longer hangs outside the
  host's corner (which had started covering the Share/Ask labels and the
  keep-day flag for `size="compact"`, and the hero's third stat tile for
  `size="container"`) — compact now reserves a `pr-6` gutter and pins the
  badge inside it; container insets to the dotted border instead of hanging
  past it. The existing rationale comment for the prior (outside-hang)
  approach is kept and extended, not deleted. Added the previously-missing
  test for the conditional-`relative` branch (`preview.tsx`'s
  `callerSetsPosition` logic).
- `8efda6a` — **Task 8.5.** Home page rhythm (`PageContainer width="content"`,
  new named `.home-rhythm`/`.home-stack` classes in `globals.css` for the
  30px/60px/34px values, none of which sit on Tailwind's scale), a
  `data-testid="page-date-line"` date line, a real `"All trips"` heading plus
  a singularized trip-count line, and `NextTripHero`'s traveler-count label
  singularized to match its own aria-label. **Both honesty points resolved
  for real, not papered over:** the third stat tile now reads
  `TripDetail.conflicts.length` (already-fetched real data) instead of a
  hardcoded `"2"` — the `<Preview id="home-decisions">` wrap that had been
  covering it is gone, and so is its now-orphaned registry entry; and
  **KI-34** records that `TripSummary` has no start date (so "next trip" is
  list-order not date-order, and trip cards show `createdAt`), fix path a
  contract change, out of scope for this presentational-only plan. One
  deliberate test skip: the phase doc's own "shows the trip's dates rather
  than its creation date" test cannot pass without exactly the contract
  change KI-34 defers — `it.skip` with a comment pointing at KI-34, not a
  fabricated date.
- `fdaf232` — **Task 8.6.** `CalendarLens.tsx`'s in-trip cell is now two
  nested elements: an outer `bg-surface` cell holding the 116px min-height,
  and an inner real `<button>` carrying the tint background — matching the
  design's "tinted button inside a surface cell", not a tinted cell itself.
- `2a01d02` — **Task 8.7.** New `lib/place.ts` (`shortPlace`): prefers the
  geocoder's structured `location.city`, falls back to the first
  comma-segment of `location.name`, `null` for no location. Used in
  `TimelineLens.tsx`'s day-route line and `ActivityRow`'s place line in place
  of the raw full geocoded label. The "no dangling `·` separator" behavior
  was already correct going in (verified, not assumed); added the missing
  `data-testid="day-meta-{dayId}"` and a regression test. **KI-35** records
  that neither this nor `DayChips.tsx`'s `cityFor` has a true "area" field to
  read — both are a city-or-first-segment approximation — fix path a
  contract change, out of scope.

**Phase 8 exit checklist verified against the branch as it stands** (Task
8.7's own subagent did this read-only pass across all seven commits before
reporting done): leg copy, accent distinctness + KI-18 Resolved, day-chip
typography, Preview badge non-overlap plus the new test, home rhythm/heading/
singularization/real-stat-tile, calendar inner button, and both new
known-issues entries all confirmed present — no gap found needing a fix
before the PR.

**Verification, orchestrating session, after all seven commits (not just
each task's own local check):**

- `pnpm typecheck` (repo root, all workspaces) — clean.
- `pnpm --filter web lint` — clean.
- `node scripts/check-color-wall.mjs` — OK, 290 files scanned, 0 pending.
- `pnpm --filter web test` — **103 files, 686 passed, 1 deliberately skipped**
  (the Task 8.5 TripCard-dates test, per KI-34).
- `pnpm --filter web test:e2e:ci-like` — **got a real local signal this
  time**, unlike Phase 7 (KI-33 blocked `next build` outright there). This
  session's environment had neither a running Postgres nor a matching
  Playwright browser build out of the box; both were fixed locally rather
  than skipped:
  - `DATABASE_URL` wasn't set and no `.env.local` existed, so `pnpm build`
    failed collecting page data for `/api/health/ai-mode` (needs a live DB
    connection to build, not just to run). A system-installed
    `postgresql-16` (not started by default; no `docker` daemon available in
    this container to run the repo's own `docker-compose.yml`) was started
    via `pg_ctlcluster`, a `travel` database created, the `postgres` role's
    password set to match `.env.example`, and a local `apps/web/.env.local`
    written pointing at it (port 5432, the system cluster's default, not
    5433 — `.env.local` is gitignored, this doesn't touch the repo).
    `pnpm db:migrate` applied cleanly. Rebuild then succeeded (still with
    the long-standing, unrelated, already-root-caused KI-26
    `@vercel/flags-definitions` build warning — cosmetic, expected).
  - **KI-32 in a slightly worse form than its entry describes:** the image's
    Chromium build (1194) didn't match `@playwright/test`'s wanted build
    (1228) for *either* browser flavor, and — unlike KI-32's own symlink
    workaround, which was written against the plain `chromium` build — the
    `chromium_headless_shell` package's internal layout actually **renamed**
    between the two versions (1194: `chrome-linux/headless_shell`; 1228:
    `chrome-headless-shell-linux64/chrome-headless-shell`), so a single
    top-level directory symlink (KI-32's documented fix) wasn't sufficient
    for the headless-shell flavor Playwright actually launches by default —
    it needed a nested directory built from individual file symlinks,
    including one renaming the binary itself. Done in `/opt`, not the repo,
    same as KI-32's own workaround — doesn't survive a new container, and
    KI-32's entry is accurate enough as the pointer to reach for; not
    updating the entry itself over one extra wrinkle in the same class of
    fix.
  - With both fixed: **21/22 e2e tests passed.** The one failure is
    `m8-make-it-real.spec.ts`'s delete-trip step, and it is **exactly**
    KI-28's documented symptom and mechanism verbatim — `getByRole("menuitem",
    { name: /delete/i }).click()` timing out with "element is outside of the
    viewport" after the automatic CI retry — a known, pre-existing,
    already-filed flake (2026-08-23) about the trip list accumulating cards
    across a suite run and pushing a late card's popover out of room to
    flip. Not re-diagnosed further here: this session's local DB had
    *already* accumulated trip cards from an earlier failed attempt at this
    same verification pass (the build/browser fixes above took two more
    full-suite attempts to reach a real run), which plausibly makes KI-28
    easier to hit locally right now than on a fresh CI run — consistent
    with, not evidence of, Phase 8 worsening it. Phase 8's own diff doesn't
    touch the trip-actions `Popover` or its trigger's positioning; Task 8.5
    does add page content above the grid (a date line, an "All trips"
    heading), which could in principle push cards further down and interact
    with KI-28's mechanism, but one flake on a DB already primed for exactly
    KI-28's failure mode isn't enough evidence either way. Left exactly as
    documented in KI-28 (not re-scoped, not "fixed") rather than guessed at.

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
- **On `main` right now: Phases 0-4 done and merged, Phases 5-9 not
  started.** Verified by presence/absence in `main`'s tree, not just by an
  unchecked plan file (the phase files' own `- [ ]` step markers are never
  checked regardless of completion, so they aren't a reliable signal on
  their own) — but "absent from `main`" is not the same claim as "not
  started": check `claude/*` branches too before assuming a phase with
  nothing on `main` is untouched.
  - **Phase 3 (rack) — done, merged to `main`** (PR #26, 2026-08-23; see
    "Known gap" above for the full landing story).
  - **Phase 4 (budget) — done, merged to `main`** (PR #25, 2026-08-22/23).
  - **Phase 5 (overlaps) — done, merged to `main`** (PR #29, 2026-08-23).
    `OverlapWarning.tsx`, `overlapData.ts` and `time-overlap` handling in
    `TimelineLens` are all on `main` — see the Phase 5 section above. Its
    Step 4 manual browser pass is still outstanding.

  - **Phases 8b and 1b (2026-08-23 design sync) — approved, not started.**
    `docs/plans/M10-delta/phase-8b-design-sync.md` and
    `phase-1b-header-scope.md`; both are gate-scope amendments recorded in
    `docs/milestones/M10-visual-craft.md`.
  - **Phase 6 (add-a-day, empty states) — done, merged to `main`** (PR #30,
    2026-08-24). See the Phase 6 section under "In flight" for what landed and
    what it deliberately did not.
  - **Phase 7 (forms) — done, merged to `main`** via PR #32 (plus a small
    follow-up PR #33 removing a stray hint). See the "Phase 7" section under
    "In flight" above for what shipped, the crash bug found via manual
    browser verification, two rounds of CI/CodeRabbit fixes, and KI-33.
  - **Phase 8 (polish, incl. home) — done, merged to `main`** via PR #35.
    See the "Phase 8" section under "In flight"
    above: leg-line
    copy, KI-18 closed for real (collision-probed day accents), day-chip
    typography, Preview badge non-overlap, home rhythm/heading/
    singularization/real-conflict-count stat tile plus KI-34, calendar
    inner-button cells, and shortened route/place lines plus KI-35.
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
- **Design source of truth (moved in-repo 2026-08-23):**
  `.design-sync/handoff/design/Trip Planner Redesign.dc.html` (3,524 lines),
  with `.design-sync/handoff/SPEC.md` and `DRIFT.md` beside it. The
  `~/Downloads/design_handoff_update/` path this line used to name exists in no
  session and never will; generations 1-3 (1,412 / 2,048 / 2,623) are
  unreadable, so **generation-diffing is over** — reconcile design against
  *code*, using `apps/web/src/lib/preview-registry.ts` as the spine for "not
  built yet", the way `DRIFT.md` does.
  The in-repo file is **newer than what Phases 0-9 were written against**: it
  adds a landing page, sign-in/sign-up, a first-run screen, an account menu and
  a full Notebook redesign, and renames the product to **Caesura**. That delta
  is reviewed, questioned and routed in
  `docs/design-feedback/2026-08-23-design-sync-review.md` — headline: **M15**
  takes landing/auth/first-run/account menu (approved, executes after M10 and
  before M9 — ADR-021), **M14** takes the Notebook redesign and a repeaters
  ADR, **M11** takes the landing page's "Look around a real trip" CTA, and the
  M10-scoped items became **Phases 8b and 1b**, both approved into M10's gate.
  The "Design sync" section above has the detail; two questions remain open,
  both carried into `docs/milestones/M15-front-door.md`.

**Phases 3, 5 and 6 are merged; Phase 7 is implemented with its PR open, not
yet merged — pick up Phase 8 next**, which is independent of everything else
and could go in parallel across sessions (`docs/plans/M10-delta/phase-8-*.md`)
— but check for its own stray branch first (see `AGENTS.md`'s Workstreams
section) before assuming it is untouched; the exact same landing gap that
happened to Phase 3 is why that check exists. Then **8b** and **1b** (the
design sync's approved gate additions — 1b depends on Phase 7 being *merged*,
not just PR-open), then 9. Phase 9 (gate) is last, after all of 5-8 land —
which for a phase worked in its own session means after its PR is opened
*and merged*, not merely after the branch was verified (Phase 3's own landing
gap is exactly this lesson). Branch any
genuinely new phase work from current `main`, not from PR #23's or PR #26's
old branches (both merged, empty diff against `main` now) or from any other
stale branch without checking it first.

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

### KI backlog pass and skill hardening — merged to `main` 2026-08-24 via PR #44 and PR #45

Not milestone work and it moves no gate; recorded here so the next session
does not re-open closed issues. **PR #44** ran `ki-fixer` subagents in parallel
worktrees (KIs are independent of the phase chain, so they parallelize safely):
**KI-6** (`listPages` race), **KI-20** (retire lenses), **KI-29** (double
overlap) and **KI-31** (orphan guard) are closed and moved to Resolved in
`docs/known-issues.md`; **KI-28** was re-scoped rather than fixed — its
trip-actions "Delete"-outside-the-viewport symptom in `m8-make-it-real.spec.ts`
is still the documented, expected e2e flake, so seeing it is not a new finding.
It also fixed the `minimal-check-subset` skill. **PR #45** hardened the
`/cleanup-orphans` skill after its first real run against this repo.

Fourteen known issues remain open (KI-3, 5, 9, 10, 11, 12, 15, 22, 23, 24, 28,
32, 34, 35); most are M9/AI scope. `docs/known-issues.md` is authoritative.

### Earlier-gate reconciliation and orphan cleanup — 2026-08-24, on `claude/reload-skills-d51dc6`

Bookkeeping only; no product code touched, no gate moved.

**M2's gate was never recorded.** `TODO.md` showed M2 ticked, but
`docs/milestones/M2-history-time-travel.md` had **all nine exit-gate boxes
unticked and no retro** — the exact drift `docs/milestones/README.md`'s
gate-close checklist opens by naming. On Mitchell's instruction to assume the
earlier gates were done, the boxes are now ticked and a retro appended. **The
retro is explicitly marked retroactive** and splits its claims: five boxes
(property tests, golden rebuild, the projection boundary, the concurrency
conflict, and the contracts-changelog entries) were **verified from artifacts
still in the tree**; three (preview/Neon infra, the deployed-URL demo, "all
M0+M1 gates still green") are **assumed, not verified** — point-in-time checks
from July 2026 that nothing preserves. Do not cite M2's boxes as evidence
without reading that split.

**M3** had one unticked box, the deployed-Vercel demo. Ticked on the same
basis, with a note in its retro recording that it was ticked late and on
inference rather than a re-run.

**Orphan cleanup:** seven merged worktrees removed (all clean, all confirmed
ancestors of `origin/main`), seven stale `.claude/launch.json` entries pruned
(that file is gitignored and local-only), and eight provably-merged local
branches deleted with `git branch -d`.

**Three unmerged local branches were checked and then deleted** —
`claude/m10-wave2-phase3-onward` (1 commit), `claude/next-milestone-388cd0`
(59, last 2026-07-26) and `claude/trip-builder-agent-7905a3` (29, last
2026-08-02). `-d` refused all three, so each was spot-checked against `main`
before `-D`, and every headline marker was found already landed:

- **phase3-onward's** only commit adds a `STATUS.md` paragraph naming itself
  as Phase 3's resume point (2026-08-17). Phase 3 merged via PR #26 on
  2026-08-23 and this file has been rewritten repeatedly since — pure
  obsolete self-reference.
- **next-milestone-388cd0** — `main` has M7's `## Post-gate retro (2026-07-21
  → 2026-07-26)`, KI-11, KI-12 and KI-13, and the AI step-budget code
  (`handleAiRequest.ts`).
- **trip-builder-agent-7905a3** — `main` has KI-15, `geocodeEnrichment.ts` and
  `geocodeRegion.ts` (the server-side geocoding), `TripHeader.tsx`'s
  render-from-`activeTrip` optimism fix, and `page.tsx`'s `deletingIds`
  optimistic delete.

This was a spot-check of headline markers, not a file-by-file audit; the
branches are recoverable from the reflog for now if something was missed.

**Remote branches: all eleven deleted** — the nine merged into `origin/main`,
plus `origin/claude/m10-wave2-phase3-onward` and
`origin/claude/next-milestone-388cd0`, the counterparts of two of the three
above. `origin/main` is now the only remote branch.

### Phase 8b (design sync presentational items) — implemented on `claude/m10-wave2-phase8b`, awaiting a PR

Six commits (`9174e06`..`97b1539`), per
`docs/plans/M10-delta/phase-8b-design-sync.md`. Five of six tasks shipped:
the product is renamed **Caesura** (`9174e06`); a header account menu with a
working **sign out** (`7d3b6c8`, plus `86ec93f` for a color-wall fix); the
calendar renders one trimmed block per month (`cae8fa7`); and the trip
start is picked with the end derived, no end-date input anywhere
(`97b1539`).

**Task 8b.4 (the persistent sync-failure banner) was deliberately not
shipped**, per the plan's own instruction to stop and report rather than
fabricate a trigger: `optimistic.ts`'s `failHead` discards the entire
pending queue on a failed send (no retry, no on-device persistence, no
failure timestamp, no retained count), so the design's copy — a live count
of unsent changes, a real `(since <time>)`, and a **Retry now** action —
would be false in every clause. Filed as **KI-36** (same bug class as KI-5:
silent loss from an in-memory optimistic queue, different trigger). The same
gap forced Task 8b.3's save indicator (`e37cc20`) to ship only the
saved/saving states, dropping the error state the design also specifies.
`docs/design-feedback/2026-08-23-design-sync-review.md` §6 and
`docs/known-issues.md` carry the full record. Milestone routing for the
banner is not decided here — blocked on KI-36, to be routed at the Phase 9
gate.

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

**Review and merge PR #46.** `claude/m10-wave2-phase8b` (25 commits,
`9174e06`..HEAD) is open, CI green, CodeRabbit passed, all 20 preview
comments resolved. See "Phase 8b" under "In flight" above for what shipped,
why Task 8b.4 deliberately did not, and the demo-data section for the dev
tooling folded in on top.

**Decide before merging whether this PR ships whole.** It is no longer only
Phase 8b — see the scope note in this file's header. Splitting the demo-data
endpoint out is still cheap and would leave the phase tasks reviewable on
their own terms.

**Three things are deliberately unfinished on this branch**, each recorded
where it belongs rather than silently dropped:
1. **Task 8b.4's sync-failure banner** — no honest trigger until the send
   queue can report persistent failure (**KI-36**). Milestone routing is left
   for Mitchell at the Phase 9 gate, not assigned here.
2. **Calendar drag** — the day cards and stop chips are built to the design's
   drag affordance, but `cursor: grab` was deliberately withheld so the UI
   does not promise a drag it cannot perform. Recorded in `TODO.md`'s
   "Unscheduled rack: drag support is Board-view-only" entry.
3. **`packages/domain`'s conflict-banner formatter** still spells out currency
   codes while the rest of the UI now renders symbols — a `packages/` change
   is its own reviewed step per `AGENTS.md`, so it was left alone.

**Known imperfection in the demo seed, by decision not oversight — now
**KI-39**:** **51 of 72** stops carry coordinates. The per-city bounded lookup
rejects a wrong *city* but not a wrong *venue in the right city*, which is how
three wrong pins passed it (Kegon Falls → Urami Falls; Zentis Osaka → a
different hotel; Shin-Osaka → Shinagawa). **Those three entries were deleted
rather than shipped** — a missing pin beats a confidently wrong one, the same
principle that kept Task 8b.4 unshipped. KI-39 records that a name-identity
check is needed before the overlay is trusted or regenerated; the geocoding was
deliberately NOT re-run. Mitchell's call: *"lets just go do our best, its seed
data."*

`main` is at `c630152`. Six orphan worktrees are still on disk and in
`.claude/launch.json`; `/cleanup-orphans` (hardened in PR #45) is the way to
clear them.

**Phases 8b and 1b are the 2026-08-23 design sync's approved additions to this
gate** (see the "Design sync" section above and the gate-scope amendments in
`docs/milestones/M10-visual-craft.md`). **Phase order to the gate is 5, 6, 7,
8, 8b, 1b, 9** — 1b depends on both Phase 7 and Phase 8b, so it starts once
8b merges. Then Phase 9's gate (`docs/plans/M10-delta/phase-9-gate.md`):
before/after screenshots, KI-2/3/4 closed or re-deferred, presentational-only
diff verified, all tests incl. e2e green, retro appended — **plus, per the
2026-08-24 amendment above, routing Task 8b.4's banner (blocked on KI-36) to
a milestone.** **M15 Front door comes next once M10's gate closes, then M9**
(ADR-021) — neither may start early.

**The debt that keeps rolling forward: the manual browser walk.** Phase 5's
Step 4, Phase 6's Step 4, and Phase 8's exit checklist were each never walked
by hand — three phases deep now. Phase 9's gate makes this blocking, so it
cannot roll past that point. The PR template's "Verification actually
performed / Not run, and why" section exists specifically to stop this
accumulating silently.

Two smaller things still wanting a human: KI-29's card-level design question
wants an answer at the Phase 9 gate, and Phase 8's Task 8.5 judgment call —
the `TripCard`-dates test is `it.skip`'d rather than forced green, because it
directly requires the contract change KI-34 defers — should be confirmed
rather than silently "fixed".

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
