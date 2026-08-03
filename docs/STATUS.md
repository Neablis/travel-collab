# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-07-31**

## Where we are

**M0–M7 are all complete and merged.** M7 (Solo delight) landed on `main` via
PR #15 on 2026-07-26 (merge commit `4093b59`).

**Phase 1's gate has NOT been met.** Every milestone is ticked, but the gate is
"Mitchell plans a real trip end-to-end and needs no other tool," and he can't
yet. That is the gate working, not a bookkeeping slip. The next roadmap item is
the Phase 1 gate review, not M8.

## In flight

**M8 is designed and planned but not started.** No code has been written and no
branch carries unmerged work — the two artifacts are on `main`:

- Design spec: `docs/specs/2026-07-28-M8-make-it-real-design.md` (`b547fdd`) —
  8 decisions, each recorded with the alternatives it beat.
- Implementation plan: `docs/plans/2026-07-28-M8-make-it-real.md` (`9a77af6`) —
  25 tasks / 142 TDD steps, four sequential waves (A lifecycle → B subtractive
  → C ergonomics → D states). Start at **Task A1**.

Two corrections to the domain surfaced while planning and are already folded
into the spec — read them before touching `packages/domain`:

1. `SetTripDates` carries `newDayIds`. Extending a trip emits `DayAdded`, which
   needs a `dayId`, and the domain may not mint UUIDs (Invariant 4).
2. **`diffTripStates` needs a `name` reconciliation step, not just `status`.**
   `diff.ts:12` claims name never differs between two states of one trip;
   `SetTripName` falsifies it, and `tripStatesEqual` compares `name`, so
   without it the M2 round-trip property goes red. Task A6, same shape as KI-1.

## Blocking / broken right now

**Nothing blocking M8** — but **KI-15 is a live correctness bug on `main`**,
filed 2026-08-02 from dogfooding: AI geocode enrichment overwrites correct
model-supplied coordinates with an unbiased top match (a Niagara Falls dinner
was persisted in Shropshire, England) and silently swallows rate-limit failures
into coordinate-less locations (7 of 9 on that run). Every AI-planned trip built
today stores wrong or missing coordinates and reports success either way. The
architectural fix is scoped into M9 ("Grounding"); the throttle/bias/surface-the-
failure half is smaller and does not need to wait.

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

**Execute M8 Wave A, starting at Task A1** of
`docs/plans/2026-07-28-M8-make-it-real.md`. Wave A is the trip-lifecycle
contract change and is its own reviewed step before any UI work (AGENTS.md
workstream rule). Background on why the milestone exists:

**M8 — Make it real** (`docs/milestones/M8-make-it-real.md`). The Phase 1 gate
review ran on 2026-07-28 without the dogfood data, because the dogfood could not
be attempted: a trip cannot be renamed or deleted. M8 closes that floor, then
the gate runs for real.

The roadmap was restructured in the same review — M8/M9/M10 are new, Fork &
remix moved ahead of Collaboration, and everything from the old M8 onward
renumbered. `docs/milestones/README.md` carries the mapping; closed milestone
files and closed design specs were deliberately not rewritten.
