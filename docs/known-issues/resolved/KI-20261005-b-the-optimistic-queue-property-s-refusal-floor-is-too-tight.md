### KI-2026-10-05-b — the optimistic-queue property's refusal floor is too tight, and fails CI by chance — RESOLVED (duplicate of KI-2026-10-14-c)

- **Severity:** minor (a red `test / unit` on a PR that did not touch the code; a re-run passes).
- **Area:** `apps/web/src/components/trip/context/optimistic.test.ts`, *the optimistic queue loses
  nothing under any interleaving (KI-2026-09-05-p)*, `refused.atLeast(7)`.
- **Symptom / What happens:** CI on #327 (`14ecf38`, 2026-10-05) failed with `a server refusal
  retained (KI-36): ran 6 assertion(s), expected at least 7`. The PR touches nothing in the
  optimistic queue. The property runs 200 unseeded fast-check cases, and the witness counts the
  runs that reach a server refusal. Its floor, 7, is half the minimum (14) of the eight runs it was
  calibrated on.
- **Measured, 2026-10-05:** 40 local runs gave 11 to 30 refusals, median about 20. So 6 is a deep
  tail, not a vacuous run: vacuity collapses the count to about zero. The floor is right in kind
  and wrong in size. Eight calibration runs could not see the tail of a count this small and wide.
  The re-run of the same job on the next push passed.
- **Fix, not made here (outside #327's scope):** `refused.atLeast(3)`, which still catches
  vacuity and clears the observed tail, with the floor comment updated to the 40-run figures. Or
  pin a `seed` on this one property, so its counts reproduce. The other three floors in the same
  test (`w`, `retained`, `adoptedOverQueue`) sit on much larger counts and were not seen near
  their floors.
- **First noted:** 2026-10-05, on #327's CI.
- **Closed as a duplicate, 2026-10-17 (the 2026-10-16 audit, §6). Still live: tracked in
  `open/KI-20261014-c-ci-unit-job-red-once-per-pr-not-reproducible.md`,** the umbrella for every
  unseeded fast-check floor that trips on a rare draw. This instance, its measurements and its
  fix direction are listed there. One fix (pin seeds, or bias the generators) closes the class.
  The floor was re-read in the test on 2026-10-17 and is unchanged.
