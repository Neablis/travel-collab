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

- **SECOND OCCURRENCE, 2026-09-23 — and it narrows the chain from eight hops to
  three while eliminating this entry's own named suspect.**

  CI's `static-and-unit` on `e30ca61` (PR #203, run 35804997292) reported
  **`1 failed | 3545 passed | 1 skipped`**, the only failure being the test
  **next door in the same `describe`**:

  ```
  FAIL src/components/trip/context/TripProvider.test.tsx
    > TripProvider broadcast (M13 link 2)
    > bumps remoteRevision so readers of its own tables can re-read
  AssertionError: expected '0' to be '1'
  ```

  That is `TripProvider.test.tsx:1083`, the `waitFor` on `remoteRevision`.
  PR #203 touches a Playwright config, two Node scripts, a lint wall, a
  CodeRabbit config and prose — **no product code at all**, and nothing it
  changes is reachable from a jsdom unit test. That file alone passed 5/5
  locally on the same commit.

  **THE NARROWING, and it is read off the source rather than guessed.**
  `TripProvider.onRemoteChange` opens with

  ```ts
  setRemoteRevision((n) => n + 1);
  void (async () => { /* invalidate, two cachedReads, adoptOutcome */ })();
  ```

  The bump is the **first statement, synchronous, before any await** — and the
  comment above it says why (*"Bumped FIRST, and outside the async body on
  purpose"*). So `remoteRevision` still reading `0` proves **`onChanged()` was
  never called at all**. Everything downstream of it — invalidate, the two
  `cachedRead`s, `adoptOutcome`, the adopting render — is exonerated, because
  none of it had started.

  That leaves three hops of the eight this entry listed:
  `visibilitychange → poll → fetchTripEvents → (resync || headSeq > before)`.

  **It also retires this entry's honest suspect.** The entry names the
  `setRemoteRevision` bump as *"one render between the poll landing and the
  adoption"*. It cannot be: the bump is the step that did not happen, so it
  cannot be what delayed the steps after it. And `POLL_INTERVAL_MS` does not
  discriminate either — both 5000 and 2000 are longer than `waitFor`'s 1000ms
  budget, so a missed immediate poll fails the assertion at either value.

  **One candidate inside the surviving three is ruled out by arithmetic.** A
  cursor already at 2 (so `headSeq > before` is false) requires a prior
  interval poll to have already fired `onChanged` — which would itself have
  bumped `remoteRevision` to `1` and made the test pass. So the failure is not
  "the poll ran and found nothing".

  **What is NOT established, said plainly.** Why the poll did not run. The
  remaining candidates are the `enabled` gate (`status === "ready" && … &&
  members.length > 1`) not yet being true when `becomeVisible()` fires, so
  `useTripBroadcast`'s effect has not attached the `visibilitychange` listener
  — after which the next poll is a full interval away, past the budget. Against
  that: `setOptimistic` and `setStatus("ready")` are back-to-back in one async
  continuation and React batches them into a single commit, so `dayCount`
  reaching `1` and `enabled` turning true should be the same render. Not
  proven, not disproven, and not reproducible locally — recorded as the place
  to look, not as an answer.

  **Still not fixed by raising the timeout**, for the reason below, which the
  second occurrence strengthens rather than weakens: whatever this is, it stops
  the poll, and a poll that does not run is the product behaviour M13 link 2
  exists for.

  **Two observations, both CI-only, both on commits that cannot have caused
  them** (a `docs/STATUS.md` edit, then a tooling-and-prose PR). The shape is
  now consistent enough that the next step is instrumentation rather than
  another re-run: a temporary probe for `enabled` on `RemoteProbe`, or the
  `waitFor` budget raised in a throwaway branch purely to read late-versus-
  never. Deliberately not done from PR #203, which has no business touching
  this file.

- **THIRD OCCURRENCE, 2026-09-24 — and it observes the poll not running, directly.**

  CI's `static-and-unit` on `0d5e62f` (PR #217, run 35944862989) reported
  **`1 failed | 3713 passed | 1 skipped`**. The failure is the third test in the
  same `describe`:

  ```
  FAIL src/components/trip/context/TripProvider.test.tsx
    > TripProvider broadcast (M13 link 2)
    > does not bump when the poll finds nothing
  AssertionError: expected "vi.fn()" to be called at least once
    ❯ TripProvider.test.tsx:1110  await waitFor(() => expect(fetchTripEventsMock).toHaveBeenCalled())
  ```

  PR #217 is a server-side API change and touches nothing under
  `components/trip`. The same test passed on that PR's previous head, `a2c9005`.

  **What it adds.** The second occurrence inferred "the poll never ran" from
  `remoteRevision` staying at `0`. This one does not need the inference: line
  1110 is the test's own *witness-first* assertion that `fetchTripEvents` was
  called, and it was not. The DOM at failure shows `dayCount` = `1`, so the
  provider was already rendered with its detail. The poll still did not fire
  within `waitFor`'s budget after `becomeVisible()`. That is the surviving
  candidate named above: `enabled` still false, or the `visibilitychange`
  listener not yet attached, at the moment the event is dispatched. After that,
  the next poll is a full `POLL_INTERVAL_MS` away.

  **Three occurrences, three different tests, one describe block, all CI-only,
  all on commits that could not have caused them.** The next step is still the
  instrumentation the second occurrence proposed, now narrowed further. The
  probe that settles it is whether `useTripBroadcast`'s effect has attached its
  listener by the time `becomeVisible()` runs. Still **not** fixed by raising the
  timeout.

- **Found by:** CI, 2026-09-22, on a docs-only commit.
- **First noted:** 2026-09-22.
