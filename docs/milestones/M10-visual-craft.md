# M10 — Visual craft pass

**Status:** Done. Gate closed 2026-08-10. Brought forward ahead of M9
(2026-08-08) — see
`docs/architecture/ADR-018-visual-pass-ahead-of-ai-behind-preview-seam.md` and
the design record, `docs/specs/2026-08-08-M10-redesign-incorporation-design.md`.
Order: `M8 ✓ → [Phase 1 gate review ✓] → M10 ✓ (this) → M9 → M11 → …`.

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
