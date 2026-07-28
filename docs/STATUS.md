# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-07-28**

## Where we are

**M0–M7 are all complete and merged.** M7 (Solo delight) landed on `main` via
PR #15 on 2026-07-26 (merge commit `4093b59`).

**Phase 1's gate has NOT been met.** Every milestone is ticked, but the gate is
"Mitchell plans a real trip end-to-end and needs no other tool," and he can't
yet. That is the gate working, not a bookkeeping slip. The next roadmap item is
the Phase 1 gate review, not M8.

## In flight

Nothing is mid-implementation. No open branches carrying unmerged code.

## Blocking / broken right now

**Nothing.** `main` went fully green for the first time on 2026-07-28 — all four
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

**M8 — Make it real** (`docs/milestones/M8-make-it-real.md`). The Phase 1 gate
review ran on 2026-07-28 without the dogfood data, because the dogfood could not
be attempted: a trip cannot be renamed or deleted. M8 closes that floor, then
the gate runs for real.

The roadmap was restructured in the same review — M8/M9/M10 are new, Fork &
remix moved ahead of Collaboration, and everything from the old M8 onward
renumbered. `docs/milestones/README.md` carries the mapping; closed milestone
files and closed design specs were deliberately not rewritten.
