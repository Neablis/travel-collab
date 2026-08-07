# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-08-07**

## Where we are

**M0–M7 are all complete and merged.** M7 (Solo delight) landed on `main` via
PR #15 on 2026-07-26 (merge commit `4093b59`).

**Phase 1's gate has NOT been met.** Every milestone is ticked, but the gate is
"Mitchell plans a real trip end-to-end and needs no other tool," and he can't
yet. That is the gate working, not a bookkeeping slip. The next roadmap item is
the Phase 1 gate review, not M8.

## In flight

**M8 Wave A is merged.** PR #21 (`m8-wave-a`) landed on `main` 2026-08-07
(merge commit `6502a95`) — Tasks A0–A15, dogfooding follow-ups, and the KI-15
geocode-enrichment hardening (a separate reviewed pass on top of Wave A,
`docs/plans/2026-08-05-KI-15-geocode-enrichment-hardening.md`). CI on `main`
is green including `migrate-production` (migration `0004`, trip status,
applied to production).

**Wave C and Wave D's scope was trimmed the same day (Mitchell + Claude,
2026-08-07)** — before starting Wave B, read this. C1–C3 (quick-add, a
search-to-add button, move-via-menu) and D1–D2 (first-run state, empty
states) are deferred, not planned to start next: none close a capability gap
(the existing `+ Add activity` editor and drag-and-drop already do this),
and they're the kind of surface a separate, already-underway design-tool
brainstorm for the product's future look and feel is likely to reshape —
building them now risks getting redone once M10 lands. C4 (KI-5 sync
indicator) and D3 (the e2e gate script, resized off the deferred UI) are
kept. Full reasoning: `docs/milestones/M8-make-it-real.md`'s "Scope trim"
section and `TODO.md`'s Candidate ideas. **Resume at Task B1** — Wave B is
unaffected by the trim.

- Design spec: `docs/specs/2026-07-28-M8-make-it-real-design.md` (`b547fdd`) —
  8 decisions, each recorded with the alternatives it beat.
- Implementation plan: `docs/plans/2026-07-28-M8-make-it-real.md` (`9a77af6`) —
  25 tasks / 142 TDD steps, four sequential waves (A lifecycle → B subtractive
  → C ergonomics → D states).

## Blocking / broken right now

**Nothing blocking Wave B.** **KI-15 is downgraded, not closed:** the
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

**Execute M8 Wave B, starting at Task B1** of
`docs/plans/2026-07-28-M8-make-it-real.md`. Wave A (the trip-lifecycle
contract change) was its own reviewed step before any UI work (AGENTS.md
workstream rule), and is done. Background on why the milestone exists:

**M8 — Make it real** (`docs/milestones/M8-make-it-real.md`). The Phase 1 gate
review ran on 2026-07-28 without the dogfood data, because the dogfood could not
be attempted: a trip cannot be renamed or deleted. M8 closes that floor, then
the gate runs for real.

The roadmap was restructured in the same review — M8/M9/M10 are new, Fork &
remix moved ahead of Collaboration, and everything from the old M8 onward
renumbered. `docs/milestones/README.md` carries the mapping; closed milestone
files and closed design specs were deliberately not rewritten.
