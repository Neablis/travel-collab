### KI-2026-10-12-f — the weather property sometimes never draws "today", so its coverage check fails — RESOLVED (duplicate of KI-2026-10-14-c)

- **Severity:** reliability. CI noise only; no product behaviour is wrong.
- **Area:** `packages/pages/src/macros/primitives/weather.property.test.ts:70` (the closing
  `expect([...seen].sort()).toEqual([...six modes...])` in "weatherModeOf — for all dates >
  follows the calendar and never shows what it does not have"), and its generators `datesArb`
  and `forecastArb` in the same file. Line numbers checked with `git show` at PR 424's head
  `c21205a`; that PR does not change this file.
- **Symptom:** `test / unit` fails with
  `AssertionError: expected [ 'forecast', 'no-forecast', …(3) ] to deeply equal [ 'forecast', 'no-forecast', …(4) ]`
  and `- "today"` in the diff: "today" was missing from the modes seen. Every per-case assertion
  held; only the final "all six modes turned up" check failed. Seen once on PR 424 at `c21205a`
  (2026-10-12), a PR that touches nothing under `packages/pages`. The same test passed 3/3
  locally. The full job log could not be read (the proxy returned 403 on the log blob store), so
  the text above comes from the check run's annotations.
- **Why:** the property runs 1000 unseeded fast-check cases. "today" needs `date === today` and
  a forecast in hand. The near-date branch of `datesArb` is picked half the time and lands on
  offset 0 with probability 1/29, and `forecastArb` gives a forecast in one case of three. That
  is about 0.6% per case, about 6 expected hits in 1000 cases, and about a 0.3% chance that a run
  sees none. Same family as KI-2026-10-12-a and KI-2026-10-11-a (unseeded property floors that a
  rare draw trips), so a fix for one should be considered for all three.
- **Fix direction:** bias the generator so "today" is common. For example, put the exact day
  into the offset arbitrary: `fc.oneof(fc.constant(0), fc.integer({ min: -14, max: 14 }), ...)`.
  Or pin a seed for this property. Prefer either of these to deleting the coverage check, which
  is what proves the table is reached.
- **First noted:** 2026-10-12, M45 (PR 424 review round 4).
- **Closed as a duplicate, 2026-10-17 (the 2026-10-16 audit, §6). Still live: tracked in
  `open/KI-20261014-c-ci-unit-job-red-once-per-pr-not-reproducible.md`,** the umbrella for every
  unseeded fast-check floor that trips on a rare draw. This instance, its measurements and its
  fix direction are listed there. One fix (pin seeds, or bias the generators) closes the class.
  The coverage check and the unseeded 1000-run property were re-read on 2026-10-17 and are unchanged.
