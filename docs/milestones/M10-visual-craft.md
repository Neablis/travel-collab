# M10 — Visual craft pass

**Status:** **Gate reopened 2026-08-14 — a second wave is in flight.** The first
wave's gate closed 2026-08-10 and its record below stands as written; it was true
against the handoff generation available at the time. An external review on
2026-08-14 found that generation had since been superseded twice, and that the
wave introduced three blocking defects its own gate could not see. See
**"Gate reopened"** at the end of this file. Brought forward ahead of M9
(2026-08-08) — see
`docs/architecture/ADR-018-visual-pass-ahead-of-ai-behind-preview-seam.md` and
the design record, `docs/specs/2026-08-08-M10-redesign-incorporation-design.md`.
Order: `M8 ✓ → [Phase 1 gate review ✓] → M10 (this, Wave 2 in flight) → M9 → M11 → …`.

## Why this moved ahead of M9

M5 was a full design milestone — tokens, a documented palette, shadcn adoption,
three waves, a re-skin of every surface — and Mitchell still does not like how
the product looks or feels. That is not because it was done badly. **M5 answered
"is it consistent." The open question is "is it obvious," and then "is it
beautiful."** Three different questions; running the first one twice does not
answer the other two.

So the work is split deliberately:

- **"Is it obvious"** is interaction design and lives inside **M8** and **M9**,
  inseparable from the features it shapes.
- **"Is it beautiful"** is this milestone.

The roadmap originally placed this milestone *after* M9, reasoning that M9 adds
an entire new interaction surface — conversation, streaming progress, a
proposal diff — and that M5's own history (Wave 1's re-skin partly redone in
Waves 2–3 as the layout moved underneath it) showed polishing before the
surface inventory is stable means polishing twice. **ADR-018 reversed that
call on 2026-08-08:** an external design team delivered a high-fidelity redesign
of the whole product, including M9's (and M11's) not-yet-built surfaces, drawn
from M9's own exit-gate language. That removes the design-uncertainty objection
the original ordering was protecting against — the surface inventory is now
*specified*, even though it isn't yet *built*. The Phase 1 gate review (the
other precondition the original ordering was waiting on) also closed the same
day. See the ADR for the full argument, including the alternatives rejected.

## Scope

One coherent visual pass over the redesign handoff
(`~/Downloads/design_handoff_trip_planner/`), executed via
`docs/plans/2026-08-08-M10-redesign-incorporation.md`:

- **Real restyle, real data, no behavior change:** Home (next-trip hero,
  sparkline, all-trips grid), Trip plan (sticky header, day-chips row, Timeline/
  Day-columns/Calendar lenses, retained lenses), New-trip and Add-stop dialogs.
- **Inert `<Preview>` shells** (real components, sample data, no-op handlers) for
  surfaces M9 and M11 will make functional: the Assistant rail and in-timeline
  ghost proposals (M9); the Playbooks route, keep-a-day flag + dialog, share,
  add-a-saved-day, and insert-a-Playbook (M11). A registry + sync test keeps
  every shell grep-able and accounted for.
- Per-city day-accent tokens and the bespoke hand-styled elements the handoff
  calls out (day chips, keep-day pennant flag, sparkline bars).
- Clear the accumulated cosmetic debt: **KI-2** (money formatted two ways in the
  same screen), **KI-3**, **KI-4**.
- Explicitly deferred out of this milestone: whether to collapse the lens set to
  match the redesign's 3-view TabStrip (a behavior/IA change, recorded in the
  retro, not acted on here); AI behavior of any kind (M9); Playbook persistence,
  save, share, or the "Keep this day" celebration (M11).

## Exit gate

- [x] Every surface in the redesign → milestone map (design spec) matches the
      handoff, with before/after screenshots captured. Verified live in the
      browser at every checkpoint through the build (home hero/sparkline/grid,
      trip header, day chips, Timeline/Board/Calendar lenses, retained lenses
      and dialogs, Assistant rail at both breakpoints, ghost proposal, keep-day
      flag + dialog, Playbooks route and strip, Share/Add-a-saved-day slots)
      and again in a final confirmation pass after the gate's own fixes
      landed — see the session's progress ledger for the full checkpoint list.
- [x] KI-2, KI-3, KI-4 closed or explicitly re-deferred with a reason (Task
      19). KI-2 and KI-4 fully resolved; KI-3 mixed — 4 of its 5 bullets fixed
      or closed-by-restyle, `text-danger-ink`'s raw-utility bullet explicitly
      re-deferred (now a legitimate 10+-file tone-lookup convention, not a
      stray inconsistency — centralizing it would be a disproportionate
      refactor for a cosmetic nit).
- [x] **Presentational only:** zero diff to `packages/`, `apps/web/src/server`,
      and `apps/web/src/app/api`, **except one Mitchell-approved exception**:
      KI-2's fix required grouping `packages/domain/src/trip/conflicts.ts`'s
      `fmt` to match the UI's money formatting (`apps/web/src/components/
      lenses/formatMoney.ts`) — the two rendered the same amount two different
      ways otherwise. Mitchell explicitly chose "fix it anyway, escalate the
      diff" over re-deferring when this was raised mid-build. Final
      `git diff --stat main -- packages apps/web/src/server apps/web/src/app/api`
      shows exactly `packages/domain/src/trip/conflicts.ts` (11 lines) +
      `packages/domain/test/over-budget.test.ts` (17 lines, new test proving
      UI/domain formatting now render identically) — nothing else.
- [x] No lens added, removed, or merged (the 3 redesign views map onto existing
      Board/Timeline/Calendar lenses; other lenses retained, lightly restyled).
      Whether to eventually collapse the lens set to match the redesign's
      3-view TabStrip remains an explicit open question — see "Deferred" below.
- [x] Every not-yet-functional surface is behind `<Preview id milestone>`, with
      a registry entry and the registry↔usage sync test green — no shell fires
      a real or fake side effect. All 10 registry entries (`home-worth-
      attention`, `home-playbooks-strip`, `assistant-rail`, `timeline-ghost`,
      `keep-day-flag`, `keep-day-dialog`, `playbooks-route`, `insert-playbook`,
      `share-button`, `add-saved-day`) have real usages; the orphan-guard test
      (Task 3's temporary `it.skip`, restored to a real assertion in Task 18)
      passes for real, not skipped.
- [x] All prior milestones' e2e stay green; typecheck/lint/unit/int all green.
      Final state: `pnpm typecheck` (5 workspace packages) clean; `pnpm lint`
      (ESLint + the lint wall + the color wall) clean; `pnpm test` (unit) 578
      tests across `contracts`/`pages`/`domain`/`web` green; `pnpm test:int`
      72/72 green against real Postgres; the full Playwright e2e suite
      (`m1`, `m2`, `m3`, `m4`, `m6`×2, `m7`×3, `m8`, `smoke` — 11 specs) 11/11
      green against a production build, confirmed stable across repeated runs.
      Three real regressions surfaced only by this full-suite pass (not by any
      per-task review) and were root-caused and fixed as part of closing this
      gate — see "What broke and how it was found" below.
- [x] Retro appended at gate close; roadmap docs (`README.md`, `TODO.md`,
      `docs/STATUS.md`) flipped to this order in the same gate-close commit.

## Retro

**What shipped.** One coherent visual pass across the whole specified surface
inventory: real restyle of Home (next-trip hero with a real fetched sparkline,
all-trips grid with accent-bar cards) and Trip plan (sticky header, day-chips
row, Timeline/Board/Calendar lenses, retained lenses, New-trip and Add-stop
dialogs), plus inert `<Preview>` shells for every M9/M11 surface the handoff
specified (Assistant rail, in-timeline ghost proposals, keep-a-day flag +
dialog, Playbooks route, home Playbooks strip and Worth-your-attention panel,
Share/Add-a-saved-day/Insert-a-Playbook). KI-2/3/4 cosmetic debt closed or
knowingly re-deferred. 20 plan tasks executed via subagent-driven development
(fresh implementer + reviewer per task), plus a focused post-hoc fix wave once
full-suite e2e surfaced three real regressions the per-task reviews couldn't
see.

**The anti-fabrication pattern that carried the whole build.** The single
most load-bearing decision made outside the plan's own text: `TripSummary`
(what the home page's trip list actually fetches) turned out to carry none of
the fields the handoff's home surfaces assume — no start date, no day/stop
counts, no city. Two real options existed every time this came up: fabricate
plausible-looking numbers, or go get the real data. The rule applied
consistently for the rest of the build was **never fabricate — fetch the real
`TripDetail`, derive honestly from what's actually there, or render an honest
"unavailable" state.** Concretely: the next-trip hero's sparkline was first
built against a hashed-from-tripId placeholder (caught in Task 6's review,
fixed by fetching real `TripDetail` and deriving real per-day stop counts);
the all-trips grid's avatars were added for free once the reviewer noticed
`TripSummary.members` was already in hand (Task 7); day-chip and day-header
city derivation settled on "first scheduled activity's `location.name`,"
documented in-code as an approximation rather than a real city field (Tasks
8/10/11, reused consistently rather than re-derived per surface); Timeline's
"legs" show only real elapsed time between activities, with an optional real
haversine straight-line distance when both endpoints have coordinates — never
an invented "travel time," which would imply a transport mode and speed with
no basis (Task 10). The same discipline extended to the New-trip flow: the
handoff's described "4-step wizard" was not built, because `CreateTrip` only
ever carries a trip name — collecting destination/dates/pace input across
three more steps with nowhere honest to send it would have been exactly the
kind of dishonest UI ADR-018 itself warns against (Task 13). Every one of
these was a case where the fabricated version would have looked fine in a
screenshot and been wrong in a way a real user would eventually notice.

**What broke and how it was found — three real regressions, all invisible to
per-task review.** Every one of the 20 tasks passed its own spec-compliance
and code-quality review; none of the three bugs below were visible in any
single task's diff. All three only surfaced once Task 20's gate ran the full
Playwright e2e suite against a production build — exactly the kind of
integration issue unit tests and diff review structurally cannot catch:

1. **Board drag-and-drop to a 3rd day column silently stopped working.**
   `m8-make-it-real.spec.ts` timed out waiting for a command that never fired.
   First suspected Task 11's column restyle (268px columns, horizontal
   scroll); actual cause was unrelated — cumulative page-height growth from
   Tasks 8 and 9 (the day-chips row, the taller restyled header) now commonly
   pushes the day-columns row below the viewport fold once the backlog holds
   a couple of items, so the drop point was off-screen and
   `@atlaskit/pragmatic-drag-and-drop`'s hit-testing found nothing there.
   Confirmed as a genuine M10 regression (not a flake, not an environment
   issue) by running the identical, unmodified spec against `main` — passed
   cleanly there. Fixed by wiring the library's own `autoScrollWindowForElements`
   into `Board.tsx` and making the e2e drag helper simulate a physically
   realistic, viewport-clamped drag.
2. **The Assistant rail's `<Preview>` badge was never actually pinned to the
   rail.** A Tailwind v4 cascade-order quirk: `Preview`'s own hardcoded
   `relative` class and a caller-supplied `fixed` class both target
   `position`, and Tailwind's compiled stylesheet orders `.relative` after
   `.fixed` regardless of attribute order, so `.relative` silently won every
   time. Cosmetic (the badge's position, not the shell's inertness), fixed by
   having `Preview` omit its own `relative` when the caller's className
   already establishes a positioning context.
3. **A second e2e spec (`m7-solo-delight.spec.ts`) failed for a related but
   distinct reason.** Task 6's real `NextTripHero` heading meant a brand-new
   trip's name could transiently satisfy a heading assertion via the HOME
   page's own hero heading, before an SPA navigation to the trip page had
   actually landed — so `page.url()` read immediately after captured `/`
   instead of the trip's real URL, and a later `page.goto()` reusing that
   stale URL silently went to the wrong page. Caught the same way as bug 1:
   confirmed passing on `main`, confirmed failing on this branch, root-caused
   via a Playwright trace. **Process note, kept here deliberately:** a
   debugging subagent first reported this exact failure as "confirmed
   pre-existing on an unmodified baseline" — independently re-verified by
   actually running the test against real `main` (not trusting the
   subagent's own stash-based methodology), which showed it passing cleanly,
   2/2 runs. The claim was wrong; the regression was real. Worth remembering
   for the next milestone: a subagent's "this is pre-existing/out of scope"
   claim is exactly the kind of thing to verify independently before letting
   it close out a gate, the same way any other claim in this codebase gets
   verified before being trusted.

**A second, quieter tooling gap: the color-wall lint check has real blind
spots.** `scripts/check-color-wall.mjs`'s regex requires a quote character
immediately after `className={` — any arbitrary Tailwind bracket value
wrapped in a `cn(...)` helper call (the repo's own standard pattern for
conditional classes) completely evades it, single-line or not. This let real
rule-4 violations (`w-[46px]`, `text-[9px]`, etc.) slip into five files across
four already-reviewed tasks before a routine `pnpm lint` run (not `pnpm
--filter web lint`, which only runs ESLint and misses this script entirely)
caught the first instance. Swept and fixed once discovered; every task from
that point on was briefed to run the full root `pnpm lint`, not the
narrower per-package one. The script's blind spot itself is unfixed —
worth a follow-up task, not urgent since the fix pattern (inline `style` +
`eslint-disable-next-line no-restricted-syntax`) is now well-established and
consistently applied.

**Deferred, not decided:**
- Whether to eventually collapse the lens set (`Board`, `Map`, `Schedule`,
  `Itinerary`, `Daily`, `Trip`) to match the redesign's 3-view TabStrip
  (Timeline / Day columns / Calendar) is an explicit open question — a
  behavior/IA change, not a restyle, and out of scope for a presentational-
  only milestone. `Map`/`Itinerary`/`Daily`/`Trip` got only light spacing/
  token alignment (Task 13) so they don't read as visually orphaned next to
  the three restyled lenses, but the question of whether they should still
  exist as top-level lenses is unresolved.
- `InsertPlaybookDialog` (Task 18) has no live trigger anywhere yet — the
  component and its `<Preview id="insert-playbook">` shell exist and are
  correct, but nothing currently opens it. Sanctioned by the plan's own
  "all inert, fed fixtures/no-op" framing, but M11 needs to remember to wire
  an actual trigger, not just replace the shell's data source.
- Two minor, non-blocking hygiene notes from the regression-fix pass: commit
  `34f1c15`'s subject line names Task 11 as the cause, which the investigation
  itself later disproved (the real cause was cumulative page height from
  Tasks 8/9) — left as-is rather than rewriting history, but worth reading the
  commit body, not just the subject, if this ever needs revisiting. `Preview`'s
  new conditional-`relative` logic (fix commit `f29cb6c`) has no dedicated
  unit test guarding the branch.

---

# Gate reopened — Wave 2 (the redesign delta), 2026-08-14

**Trigger:** an external design review of PR #23 (`docs/design-feedback/
2026-08-14-M10-redesign-external-review.md`), requested by Mitchell because the
branch visibly did not match the designs.

**Decision (Mitchell, 2026-08-14):** M10 does not close on PR #23 alone. The
delta is a second wave inside this same milestone rather than a new milestone —
PR #23 is unmerged, so the gate above closed on a branch, not on `main`, and the
milestone's own first exit-gate line ("every surface matches the handoff") is
not satisfied against the current design.

## Why the first wave's gate passed anyway

Nothing in the Wave-1 record below was dishonest. Two structural reasons it
could pass while the product did not match:

1. **The design moved twice, and the branch was built against the oldest
   generation.** Line counts, verified by real text diff:

   | version | lines | vs. prior |
   |---|---|---|
   | `design_handoff_trip_planner/` — what Wave 1 was built from, cited in the M10 spec | 1,412 | — |
   | `design_handoff_update/previous/` | 2,048 | 688 changed lines |
   | `design_handoff_update/current/` | 2,623 | +612 / −37 |

   The `1412 → previous` generation added the **Map view** — which is why the
   review initially recorded "the Map has no design at all." It does; Wave 1
   simply never saw it. The `previous → current` generation added the
   **unscheduled rack**, **budget and per-stop costs**, **overlap warnings**, the
   **Trip settings sheet**, **"Add a day" / end-of-trip**, and the **header meta
   pill**. (The update bundle's own `AGENT-PROMPT.md` describes `previous/` as
   "the version our current implementation was built from" — that is wrong, and
   is why there are two generations of drift here rather than one.)

2. **The e2e suite structurally could not see the worst defect.**
   `apps/web/playwright.config.ts` sets no `viewport`, so every spec runs at
   Playwright's 1280×720 default. The assistant scrim is gated
   `@media (max-width: 1179px)`. The suite therefore ran 11/11 green against a
   production build while the entire trip page was **inert** at any width below
   1180px. This is the milestone's most transferable lesson: *a responsive gate
   that only ever runs at one width is not a responsive gate.*

## What the review found (full detail in the design-feedback file)

**Three blocking defects, all in surfaces Wave 1 itself introduced:**

- The assistant scrim (`fixed inset-0 z-40`, `pointer-events: auto`, **no click
  handler**) sits over the whole trip page below 1180px. Measured:
  `document.elementFromPoint(200, 500)` returns the scrim, and clicking the
  Timeline tab does nothing. In the prototype the scrim's only job is to dismiss
  the rail.
- The activity `Sheet` renders **underneath** the rail. The sheet spans
  x 640→1280 at `z-index: auto`; the rail spans x 924→1280 at `z-index: 50`.
  356 of 640px — title and close button included — are covered.
- Below 1180px the rail also *covers* content, because `.trip-board-content`
  reserves its 356px only at `min-width: 1180px`.

**Structural drift:** the tab strip and day-chips row are not inside the sticky
header (measured at `scrollY 422`: header pinned at 147px, tabs at −274px, chips
at −236px); there is no global app header on any route, so `/playbooks` has no
way back; the add-stop sheet is still the pre-M10 editor.

**A correctness bug in the day accents:** `dayAccentFor` is `djb2(city) % 5`.
Over real city names, seven of thirteen land on `danger`, and the handoff's own
headline trip — **Tokyo → Kyoto → Osaka — renders Kyoto and Osaka identically**.
The prototype used ten buckets *with linear collision probing*; the probing is
what mattered, and it was not carried over.

## Wave 2 scope

Governed by Mitchell's scoping rule, 2026-08-14: *"build upon what exists in the
data model, and implement the UI only for things we can't build today and wrap in
the under construction UI."*

The plan is `docs/plans/2026-08-14-M10-redesign-delta.md` (an index) plus one
file per phase in `docs/plans/M10-delta/`. Ten phases, 28 tasks.

**Ships real**, because the data model already supports it — a finding that
materially shrank this wave:

| the design needs | already in the codebase |
|---|---|
| cost per stop | `ActivityView.cost: Money` |
| budget + currency per trip | `trip.budget`, `trip.currency` |
| a trip cost total and remaining | `TripDetail.tripCostTotal`, `.budgetRemaining` — **summed server-side; do not recompute** |
| unscheduled / parked stops | `trip.backlog` + `MoveActivity(toDayId: null)` |
| overlap detection and per-pair dismissal | the `time-overlap` conflict rule and `DismissConflict` |
| over-budget state | the `over-budget` conflict rule |
| days holding zero stops | already valid |
| coordinates on stops, for map routes | `Location.lat/lng`, populated by LocationIQ |

**Marked incomplete** behind the existing `<Preview>` seam, because we do not
model it and are deliberately not adding it: confirmed-vs-estimate cost state;
"was on day N" provenance; the Booked/Holds/Travel budget breakdown categories;
invite roles and "Invite someone" (`TripMember.role` exists but `"owner"` is its
only value, and there is no display name); the map legend's on-foot-vs-transit
split; add-stop's "who is in" and suggested places; the new-trip wizard's
destination chips, pace, tags and assistant-draft; "Add a saved day" (M11).

**Deliberately deferred:** routing. LocationIQ's directions API does work on the
existing key (probed 2026-08-14: a walking route returns GeoJSON geometry,
1342.1 m, 982.3 s), but it needs a server route, a cache and a rate-limit
strategy — a behaviour change, not a visual pass. It is also no longer needed:
the `1412 → previous` generation replaced the invented "29 min · Metro" leg text
with free time before the next stop, removing the design's dependency on
transport data. Map routes are straight lines.

## Wave 2 exit gate

- [ ] Phase 0's three defects fixed, each verified at 1100px in a real browser,
      not only in unit tests.
- [ ] **`playwright.config.ts` gains a narrow-viewport project** (or at least one
      spec that drives the trip page below 1180px), so the gap that let Wave 1
      pass cannot recur. This is the gate condition, not a nice-to-have.
- [ ] Every surface in `design_handoff_update/current/` is either built or behind
      a registered `<Preview>` — no third state.
- [ ] `dayAccents` gives Tokyo / Kyoto / Osaka three distinct families, and a day
      with no known city renders an explicit neutral rather than a hashed family.
- [ ] No new `packages/` or `apps/web/src/server` diff beyond Wave 1's
      already-approved `conflicts.ts` exception.
- [ ] The registry↔usage sync test stays green with every new `<Preview>`
      registered.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm --filter web test`,
      `pnpm --filter web test:int`, and the full e2e suite green against a
      production build, twice.
- [ ] Wave 2 retro appended here; `README.md`, `TODO.md` and `docs/STATUS.md`
      flipped in the same gate-close commit; the phase plans deleted per
      `docs/plans/README.md`.

**Environment note for the two suite-running gate lines above (2026-08-22).**
`test:int` and `test:e2e` both need real Postgres — locally that is
`docker compose up -d`. In a **remote container** docker is usually
unavailable; a local Postgres 16 cluster works as a substitute (commands in
the Wave-2 kickoff brief), though it is not the 17 CI uses. E2E has a second
container-only blocker: `@playwright/test` 1.61.1 expects chromium build
1228, the preinstalled browsers are 1194, and these environments forbid
`playwright install` — every spec fails to launch a browser until it is
pointed at the chromium that is present. **Neither affects a local machine**,
and neither is an app defect; both are listed here so a gate run in a
container is not mistaken for a red suite. Verified 2026-08-22: unit
501/501 and int 72/72 green on `main`; e2e not established in this
environment.

## PR #23 merged as a partial delta, 2026-08-17

**Decision (Mitchell, 2026-08-17):** PR #23 had grown to 79 commits / 161 files
(+16,387/−1,526) across Wave 1 plus Wave 2 Phases 0-2 — too large to review as
one unit. Rather than hold it open until the full Wave-2 exit gate above is
satisfied, Phases 0-2 (blockers, structure, map — see `docs/STATUS.md`'s "In
flight" section for what each shipped) merged to `main` on their own, and
Phases 3-9 continue on a new branch/PR.

**This does not close M10's gate.** The Wave-2 exit gate checklist above is
unchanged and still governs the milestone as a whole — before/after
screenshots, the narrow-viewport e2e project, every design surface built or
`<Preview>`-wrapped, `dayAccents` collision probing, the full test suite twice,
and this retro section, all still pending against Phases 3-9. Splitting the PR
only changes how the diff reached `main`, not what "done" means for M10.
`TODO.md`'s M10 line and `docs/STATUS.md`'s "Where we are" stay unchecked/open
until that gate passes for real.

## Carried into `known-issues.md` rather than fixed

Itinerary / Daily-overview / Full-trip lenses lose their nav entry when the tab
strip collapses to the design's four (Timeline / Day columns / Calendar / Map) —
their code and `?lens=` URLs keep working. This finally answers the Wave-1 retro's
open "should we collapse the lens set" question: **yes, in the nav; no, in the
code.** Also carried: the unmodelled fields listed above, and the fact that the
home hero picks `trips[0]` rather than the next trip by date, because
`TripSummary` still carries no start date.

## Gate-scope amendments, 2026-08-23 (design sync)

`docs/milestones/README.md`: *"Scope inside a milestone can flex; a gate
definition changes only by explicit decision from Mitchell, recorded in the
file."* This is that record. Both amendments come from the 2026-08-23 design
sync and its review
(`docs/design-feedback/2026-08-23-design-sync-review.md`); Mitchell approved
both the same day. **The Wave-2 exit gate above still governs — these add to it,
they do not replace anything.**

**1. Phase 8b — presentational items from the sync**
(`docs/plans/M10-delta/phase-8b-design-sync.md`). Runs after Phase 8, before
Phase 9's gate:

- the product is renamed **Caesura** (`AppHeader`, `metadata.title`);
- a working **Sign out** behind a header account menu — a capability gap today, since nothing in `apps/web/src` calls the `signOut` that `server/auth.ts` exports;
- the save indicator becomes three states (saved / saving / error) instead of two strings;
- sync failure gets a persistent `Banner variant="danger"`, reusing `ConflictBanner`'s vocabulary rather than adding a second banner pattern;
- the calendar renders one trimmed, headed block per month instead of one continuous padded grid;
- (added later the same day) **Task 8b.6** — see amendment 3 below.

**2. Phase 1b — the header adopts the focus-scope model**
(`docs/plans/M10-delta/phase-1b-header-scope.md`). An explicit revisit of the
merged Phase 1, running after Phase 7 and Phase 8b, before Phase 9's gate.
`SPEC.md` §1 supplies a model — one focus scope at a time, account → trip → day
— that Phase 1's own decision was made without. Share moves out of `TripHeader`
into the header in trip scope, Quick add arrives there (opening Phase 7's
add-stop sheet), and Calendar/Map drop day scope by definition. `AppHeader`
stays a server component: the actions are portalled into a client slot from the
trip screen, so `layout.tsx` is not client-ified — which was the actual reason
behind the Phase 1 decision, and is preserved.

**Why these two and nothing else.** The sync also brought a landing page,
sign-in/sign-up, a first-run screen and a whole Notebook redesign. Those are
routed **out** of M10 — to **M15 Front door** (ADR-021), **M14**, **M11**, and a
standalone contract step — precisely so this gate does not reopen a third time.
The review's §6 carries the full routing table.

**Phase 9's exit checklist now covers Phases 8b and 1b too.**

**3. Task 8b.6 — the trip start is picked, the end is derived.** Added to Phase
8b later the same day, on Mitchell's call: *"I do not want us picking an end
date, it makes the UI awful. The end date will always be start date + number of
days in trip = full trip."* (`SPEC.md` §3.)

This looked like a behaviour change and is not one. `endDate` is stored nowhere
— not on `TripState`, not on `TripDetail` — and `TripHeader.tsx:228` already
derives it from the plan's last day. `decide.ts:155` already supports the
start-only path. Days are already the truth; only the *editable end-date input*
disagreed with them. Removing it is a UI-only diff with no contract, command or
domain change, which is why it is in M10 rather than after it. **Runs after
Phase 6**, since changing a trip's length then means adding or removing days,
which Phase 6 makes real in every view. Phase 7's wizard step 2 loses its
"Leave" input in the same decision.

It also closes `TODO.md`'s "end-date picker may drift from the day count" item —
and corrects its diagnosis: not stored-field drift, but a derived value shown in
an editable field.
