# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-08-07 (Wave B merge)**

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

**M8 Wave B is merged.** Landed on `main` 2026-08-07 (fast-forward merge
`bc2295e`) — Tasks B1–B3, built via `superpowers:subagent-driven-development`
(fresh implementer + task reviewer per task, plus a final whole-branch
review). B1 retired the anchors-editing UI (`AnchorEditor.tsx` deleted;
`ActivityEditor.tsx` no longer authors anchors) while keeping the anchor
conflict rules and their tests dormant-but-green (D-1). B2 removed the
unread `ConflictContext.timezone` / `TRIP_TIMEZONE` and amended ADR-006. B3
pulled the Notebook's `{{` macro-autocomplete out of the editor while
keeping `MacroNodeExtension` registered, so existing macro nodes still
render and round-trip through save; the seeded Trip Overview / Day Sheet
templates are now plain starter text. `pnpm typecheck`, `pnpm lint`, and the
`@tc/domain`/`@tc/pages` suites are all green on `main`; the `apps/web` unit
suite is green apart from two pre-existing KI-13-flaky tests
(`PageScreen.test.tsx`, `TripHeader.test.tsx`) confirmed untouched by this
branch and passing in isolation.

**One open item from B1:** its production safety check (confirm no live
trip already carries an anchor, via a `psql` count against
`PRODUCTION_DATABASE_URL`) was explicitly skipped on Mitchell's instruction
— `PRODUCTION_DATABASE_URL` isn't available outside CI. If it's ever run and
returns non-zero, clear those anchors with an `UpdateActivity` command
(`anchors: []`) per activity, never by writing the projection directly
(Invariant 1); until then an activity with a pre-existing anchor would keep
firing an anchor-violation conflict with no UI surface to explain or clear
it (the dormancy the rest of B1 relies on).

**Wave C and Wave D's scope was trimmed 2026-08-07 (Mitchell + Claude)** —
before starting either, read this. C1–C3 (quick-add, a search-to-add
button, move-via-menu) and D1–D2 (first-run state, empty states) are
deferred, not planned to start next: none close a capability gap (the
existing `+ Add activity` editor and drag-and-drop already do this), and
they're the kind of surface a separate, already-underway design-tool
brainstorm for the product's future look and feel is likely to reshape —
building them now risks getting redone once M10 lands. C4 (KI-5 sync
indicator) and D3 (the e2e gate script, resized off the deferred UI) are
kept. Full reasoning: `docs/milestones/M8-make-it-real.md`'s "Scope trim"
section and `TODO.md`'s Candidate ideas. **Resume at Task C4.**

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

**Execute Task C4 (the KI-5 sync indicator), then Task D3 (M8 e2e and gate
close)** of `docs/plans/2026-07-28-M8-make-it-real.md` (lines 2008 and 2175)
— the two Wave C/D tasks the 2026-08-07 scope trim kept. C1–C3 and D1–D2 stay
deferred; do not start them without Mitchell's explicit say-so. Wave A (the
trip-lifecycle contract change) and Wave B (the anchors/timezone/macro
subtraction) are both done. Background on why the milestone exists:

**M8 — Make it real** (`docs/milestones/M8-make-it-real.md`). The Phase 1 gate
review ran on 2026-07-28 without the dogfood data, because the dogfood could not
be attempted: a trip cannot be renamed or deleted. M8 closes that floor, then
the gate runs for real.

The roadmap was restructured in the same review — M8/M9/M10 are new, Fork &
remix moved ahead of Collaboration, and everything from the old M8 onward
renumbered. `docs/milestones/README.md` carries the mapping; closed milestone
files and closed design specs were deliberately not rewritten.
