### KI-2026-10-12-a — the costs property's over-budget floor can trip on a low random draw — RESOLVED (duplicate of KI-2026-10-14-c)

- **Severity:** reliability. CI noise only; no product behaviour is wrong.
- **Area:** `packages/domain/test/costs.property.test.ts:158` (`w.atLeast(7)` in "recomputes the
  over-budget conflict with the totals, so the banner and the board agree", witness
  `recost moves the over-budget conflict`), and the witness helper
  `packages/domain/test/support/witness.ts`.
- **Symptom:** `test / unit` fails with the witness's vacuity message: the over-budget witness ran
  6 assertion(s), expected at least 7. The property itself held; the floor tripped. Seen once on
  PR 422 at `3f3ee41` (run 38259706383), which does not touch cost code. The same head passed 3/3
  locally.
- **Why:** the property runs 400 unseeded fast-check cases, and `w` ticks only where the join
  pushes a within-budget trip over budget, a narrow slice of the draw. The floor was set at half
  the observed minimum (14–30 over 27 runs); a rare draw still falls below it. Same mechanism as
  KI-2026-10-11-a (the quota property's `rolled` floor), so a fix for one should be applied to
  both.
- **Fix direction:** pin a seed for this property (keeping the floors meaningful), or bias the
  generator (budget drawn relative to the cost total) so crossing the budget is common enough for
  the floor to have headroom, rather than only lowering the floor.
- **First noted:** 2026-10-12, M45 (PR 422).
- **Closed as a duplicate, 2026-10-17 (the 2026-10-16 audit, §6). Still live: tracked in
  `open/KI-20261014-c-ci-unit-job-red-once-per-pr-not-reproducible.md`,** the umbrella for every
  unseeded fast-check floor that trips on a rare draw. This instance, its measurements and its
  fix direction are listed there. One fix (pin seeds, or bias the generators) closes the class.
  The floor was re-read in the test on 2026-10-17 and is unchanged.
