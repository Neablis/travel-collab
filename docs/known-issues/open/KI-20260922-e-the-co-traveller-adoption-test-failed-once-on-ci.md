### KI-2026-09-22-e — "adopts a co-traveller's edit without a reload" failed once on CI and has not reproduced in seven local runs

- **Severity:** unknown, and that is the entry. Either a real timing race in the
  poll → refetch → adopt chain, or a scheduling artefact of a loaded GitHub
  runner. One observation is not enough to say which.
- **Area:** `apps/web/src/components/trip/context/TripProvider.test.tsx` →
  *"TripProvider broadcast (M13 link 2) > adopts a co-traveller's edit without a
  reload"*.

- **Symptom / What happens:** CI's `static-and-unit` on `fd0551b`
  (run 35778894235) reported **`1 failed | 3540 passed | 1 skipped`**, that test
  being the only failure. The commit it failed on is **docs-only** — a
  `docs/STATUS.md` edit — so nothing in that push can have caused it.

- **RULE 2 WAS FOLLOWED AND FOUND NOTHING.** `docs/known-issues/` was grepped
  for the symptom before it was called anything. The nearest neighbour is
  `KI-2026-09-20-j`, the same SHAPE (a unit test failing once on a full run and
  not reproducing) in a different file. This is a new observation.

- **What was tried, so nobody repeats it:**

  | Attempt | Result |
  | --- | --- |
  | That file alone, ×3 | 41/41 each time |
  | Full unit lane, ×2 | 3541 passed, 1 skipped |
  | `--no-file-parallelism` (changes scheduling) | 41/41 |
  | Under four `yes > /dev/null` CPU hogs | 41/41 |

  Seven runs, no reproduction.

- **What the repo's own rule says, and why it does not settle this.**
  `CLAUDE.md` rule 2: *"a failure whose location moves between runs is a timeout;
  a real defect fails in the same place every time."* It failed in the same
  place — but only once, so the discriminator has nothing to compare against.

- **The one thing that changed in the neighbourhood**, recorded because it is
  the honest suspect rather than because it is proven: **`POLL_INTERVAL_MS` went
  from 5000 to 2000 earlier the same day**, and `TripProvider.onRemoteChange`
  gained a `setRemoteRevision` bump, which adds one render between the poll
  landing and the adoption. Neither should matter — the test drives the poll
  through `becomeVisible()`, which polls IMMEDIATELY rather than waiting out an
  interval, and `waitFor`'s default budget is 1000ms against a chain of a few
  promise hops. But both landed hours before the first failure, and saying so is
  cheaper than someone else rediscovering the coincidence.

- **What would settle it.** The chain under test is
  `visibilitychange → poll → fetchTripEvents → onChanged → invalidate → two
  cachedReads → adoptOutcome → render`. If it recurs, the discriminating
  question is whether `dayCount` reaches `2` LATE (a timeout — raise nothing,
  find the slow hop) or never (a real race in the adoption). The failure output
  does not distinguish those, so the next occurrence should be captured with the
  `waitFor` timeout raised temporarily, purely to read which it is.

- **NOT "fixed" by raising the timeout.** That is how a check gets trained away,
  and this test covers the central promise of M13 link 2 — a co-traveller's edit
  arriving without a reload. It is better red occasionally than quietly
  loosened.

- **THE ONE SANCTIONED RE-RUN PASSED.** The push that filed this entry re-ran
  the lane on `24d34e0` (run 35780653901): **green, 3541 passed**. So the
  failure is now one observation against one clean re-run plus seven local
  runs. That does NOT make it a flake — it makes it unexplained, which is why
  this entry stays open rather than being closed as "could not reproduce".
  A second occurrence is the thing to wait for, and the entry above says what
  to capture when it comes.

- **Found by:** CI, 2026-09-22, on a docs-only commit.
- **First noted:** 2026-09-22.
