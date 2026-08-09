# STATUS — where the work actually is

Updated at every milestone boundary and whenever in-flight work changes hands.
Read this first on a fresh session; it is the resume-from-here file. Roadmap is
`TODO.md`, scope is `docs/milestones/README.md`, known breakage is
`docs/known-issues.md`.

**Last updated: 2026-08-08 (M8 gate closed)**

## Where we are

**M0–M8 are all complete and merged.** M8 ("Make it real") closed its gate
2026-08-08 — see `docs/milestones/M8-make-it-real.md`'s retro. `docs/milestones/
README.md`'s Current milestone pointer is now **M9**.

**Phase 1's gate has NOT been met yet.** Every milestone through M8 is ticked,
but the gate is "Mitchell plans a real trip end-to-end and needs no other
tool," and that dogfood run hasn't happened since M8 closed the floor it was
blocked on (a trip couldn't be renamed or deleted before M8). **The next
roadmap item is the Phase 1 gate review with Mitchell — not diving into M9.**
`TODO.md` carries this as its own unchecked line between M8 and Phase 2.

## In flight

**Nothing in flight.** M8 is fully closed: Wave A (trip lifecycle, PR #21,
merged 2026-08-07), Wave B (anchors-UI retirement, `ConflictContext.timezone`
removal, Notebook macro-authoring pullback — merged 2026-08-07, commit
`bc2295e`), and Wave C/D's kept tasks — **C4** (the KI-5 sync indicator,
`SyncIndicator.tsx` in `TripHeader`) and **D3** (the M8 e2e gate script,
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

**The Phase 1 gate review with Mitchell** — dogfood a real trip end-to-end
using only the product (no other tool). This is what M8 existed to unblock: a
trip couldn't be renamed or deleted before M8, so the 2026-07-28 review ran
without dogfood data. That floor is now closed, and every milestone through
M8 is done — this review is the actual next `TODO.md` line, not M9 work.

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
