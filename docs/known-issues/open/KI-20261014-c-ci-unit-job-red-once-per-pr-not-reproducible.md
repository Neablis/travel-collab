### KI-2026-10-14-c — CI's `test / unit` goes red once on a PR, then green: unseeded property floors that a rare draw trips (four proven, four suspected)

- **Severity:** reliability. CI noise only; no product behaviour is wrong. Each occurrence costs a
  re-run or a push cycle, and because the job log can't be read from a cloud session
  (KI-2026-10-13-f), every occurrence is triaged blind.
- **Area:** `.github/workflows/ci.yml` (`test / unit`, step "Run pnpm test:unit"), and the
  unseeded fast-check properties whose vacuity floors or coverage checks sit on small counts:
  - `apps/web/src/components/trip/context/optimistic.test.ts`, *the optimistic queue loses
    nothing under any interleaving (KI-2026-09-05-p)*, `refused.atLeast(7)` (was KI-2026-10-05-b);
  - `apps/web/src/server/quota.property.test.ts`, "reserve and settle keep every counter at its
    exact net charge", `rolled.atLeast(8)` (was KI-2026-10-11-a);
  - `packages/domain/test/costs.property.test.ts`, "recomputes the over-budget conflict with the
    totals…", `w.atLeast(7)` (was KI-2026-10-12-a);
  - `packages/pages/src/macros/primitives/weather.property.test.ts`, "weatherModeOf — for all
    dates…", the closing "all six modes seen" `expect` (was KI-2026-10-12-f);
  - the witness helpers `apps/web/src/test-support/witness.ts` and
    `packages/domain/test/support/witness.ts`.
- **Symptom:** `test / unit` fails once on a PR that touches none of the code involved. A re-run
  or the next head passes, and the run doesn't reproduce locally. Each property held on every case.
  Only its floor or coverage check tripped:
  - `a server refusal retained (KI-36): ran 6 assertion(s), expected at least 7`: #327 at
    `14ecf38`, 2026-10-05.
  - `a settlement whose window had rolled: ran 7 assertion(s), expected at least 8`: PR 405 at
    `cee845f` (run 38149364972).
  - the over-budget witness ran 6, expected at least 7: PR 422 at `3f3ee41` (run 38259706383).
  - `expected [ 'forecast', 'no-forecast', …(3) ] to deeply equal [ … …(4) ]`, with `- "today"`
    in the diff: PR 424 at `c21205a`.
  - Four more where the only annotation was `Process completed with exit code 1`, so the test
    is unknown: PR 441 at `d0524ea`, PR 442 at `d70caae`, PR 444 at `c33ef09` (job
    115627045967; green on `7c597ec`) and PR 446 at `02c55a7` (job 115627633453). On `c33ef09`
    the full `pnpm test:unit` passed twice under Node 24.21, `TZ=UTC`, `CI=true` (web: 424
    files, 6029 tests). PR 441 and PR 442 passed three full web runs each.
- **Why:** each property draws 200–1000 unseeded cases. Each floor was set at about half the
  minimum seen over a handful of calibration runs, and that many runs can't see the tail of a
  small, wide count. Measured:
  - `refused`: 11–30 over 40 local runs, median about 20.
  - `rolled`: 16–28 over five runs.
  - over-budget `w`: 14–30 over 27 runs.
  - weather "today": about 0.6% per case, so about 6 hits expected in 1000 cases and about a 0.3%
    chance a run sees none. It needs the near-date branch (half the draws), offset 0 (1 in 29)
    and a forecast (1 in 3).
  - A count near zero means a vacuous run. These counts are not near zero: they are real draws
    in the low tail. Each floor is right in kind and wrong in size.
- **Fix direction:** one fix for the class, rather than lowering each floor.
  - Pin a `seed` on each property so its counts reproduce, or bias the generator so the counted
    branch is common. For the weather property, add `fc.constant(0)` to the offset arbitrary.
    For costs, draw the budget relative to the cost total. For quota, make a window roll common.
  - Lowering a floor alone (for example `refused.atLeast(3)`) is a fallback, and needs its
    comment updated with the wider measurements.
  - Don't delete a coverage check: it is what proves the table is reached.
  - To name the test behind the four unknown reds, have the unit job write vitest's failing test
    names to `$GITHUB_STEP_SUMMARY`, or upload its junit/JSON report as an artifact the API can
    read.
- **Cross-reference:** KI-2026-10-13-f (unreadable job logs); KI-2026-10-11-c
  (`suggestions.test.tsx` under full-suite load, the other suspect for the unnamed reds);
  KI-2026-09-05-p (the optimistic property). Merged here on 2026-10-17 and moved to `resolved/` as
  duplicates: KI-2026-10-05-b, KI-2026-10-11-a, KI-2026-10-12-a, KI-2026-10-12-f.
- **First noted:** 2026-10-14, during M46's walk changes; the four instances from 2026-10-05 to
  2026-10-12.
