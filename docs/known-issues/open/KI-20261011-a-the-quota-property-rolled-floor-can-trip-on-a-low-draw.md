### KI-2026-10-11-a — the quota property's "rolled" floor can trip on a low random draw

- **Severity:** minor. CI noise only; no product behaviour is wrong.
- **Area:** `apps/web/src/server/quota.property.test.ts:244-248` ("reserve and settle keep every
  counter at its exact net charge"), and the witness helper `apps/web/src/test-support/witness.ts`.
- **Symptom:** `test / unit` fails with `a settlement whose window had rolled: ran 7 assertion(s),
  expected at least 8. The property is passing vacuously …`. The property itself held; the
  vacuity floor `rolled.atLeast(8)` tripped. Seen on PR 405 at `cee845f` (run 38149364972), which
  does not touch quota code; the same test passed on that branch's earlier heads.
- **Why:** the property runs 300 unseeded fast-check cases, so the count of settlements after a
  window roll varies run to run. The floor was set at about half the observed minimum (16–28 over
  five runs, 2026-09-24); a rare draw still falls below it.
- **Fix direction:** pin a seed for this property (keeping the floors meaningful), or bias the
  generator so a window roll is common enough that the floor has headroom, rather than only
  lowering the floor.
- **First noted:** 2026-10-11, M42 (PR 405).
