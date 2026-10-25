### KI-2026-10-24-c — CI's e2e went red once on PR 533 and once on PR 537, cause unknown

- **Severity:** reliability. Each passed on a later head; neither failure is tied to a change.
- **Area:** `.github/workflows/ci.yml`, `test / e2e (n/2)`.
- **Symptom / What happens:**
  - PR 533 (M52 part 4) at `0b661f4`: run 39910504198, job 120272183090, `test / e2e (1/2)`.
  - PR 537 (M52 part 8) at `99ca1f8`: run 40006602964, job 120596075094, `test / e2e (2/2)`.
  The only annotation on each is `Process completed with exit code 1`, so the failing spec is not
  named, and the job log cannot be read from a cloud session.
- **Why not fixed here:** nothing to act on yet. Next occurrence: download the run's Playwright
  report artifact (or have Mitchell open the log) and record the spec, test and message here. If
  the failure point moves between runs, treat it as a timeout (CLAUDE.md rule 2).
- **Third occurrence, 2026-10-24 (KI sweep):** PR 550 at `053efda`: run 40142324030, job
  121016569726, `test / e2e (2/2)`, again annotated only `Process completed with exit code 1`.
  The PR changed only `components/chat/` (two files plus tests); `m46-trip-chat.spec.ts` and
  `m46-chat-unread-home.spec.ts` passed 5/5 under `test:e2e:ci-like` at that head, and
  PR 551's run of the same shard passed. The failed jobs were re-run once.
- **Naming the next one (2026-10-24):** `playwright.config.ts` now adds Playwright's `github`
  reporter when `GITHUB_ACTIONS` is set, so the next e2e red carries a check-run annotation with
  the spec, test and message — read it with
  `gh api repos/Neablis/travel-collab/check-runs/<job-id>/annotations`. The entry stays open
  until an occurrence is named and its cause found.
- **First named occurrence, and fixed (2026-10-25, KI sweep 2):** PR 565 at `5f566fb`: run
  40151416106, job 121043601055, `test / e2e (2/2)`. The `github` reporter's annotation named
  `[narrow] › e2e/responsive.spec.ts:935 › … the find moment's banner shows all four stop rows at
  1440px`, `Expected: 4 / Received: 0` at line 954, on the run and its retry (the previous head,
  `a5ad0a6`, passed; the change between touched only `components/chat/useTripChat.ts`). Mechanism:
  the test counted rows with one `panel.evaluate` as soon as the Rome link was visible, which it is
  from the server's HTML. When the sea's client repack reaches the find panel's `Suspense` before
  its lazy chunk has loaded, React renders that panel afresh: the server's node is removed, the
  drawing stands in, the real panel mounts (sampled per frame locally: panel, then no panel
  for ~0.25 s with no added latency and for seconds with chunk latency injected, then panel). `locator.evaluate` is two round trips
  (`waitForSelector`, then `evaluate` on the handle, `_withElement` in playwright-core), so a
  resolve before the swap and a run after it measure a detached panel: every box zero, 0 rows.
  Reproduced with the handle taken before hydration and evaluated after the swap: `isConnected
  false`, count `0`; the live panel at the same moment, `4`. Fixed in `e2e/responsive.spec.ts`:
  wait for the repack (`data-cols` equal to CSS's `--cols`, as the accents test already did), then
  `expect.poll` the count. Seen red for the right reason with the rows inflated by a style tag
  (`Expected: 4 / Received: 1`). Neighbours checked by marking nodes before hydration: the hero, the
  grid, the pricing ladder, every first-screen cell, card and accent, and the moment wrappers all
  survive it; only the lazily loaded feature panels are replaced, and no other test in the file
  measures inside one. Proof: `pnpm --filter web test:e2e:ci-like e2e/m42-demo-trips.spec.ts
  e2e/m37-trip-covers.spec.ts e2e/m46-trip-chat.spec.ts e2e/m14-notebook-widgets.spec.ts
  e2e/responsive.spec.ts`, 104 passed, none flaky. **The entry stays open:** the three unnamed reds
  (PR 533 on shard 1/2, PR 537 and PR 550 on shard 2/2) cannot be tied to this test. It needs only
  a slow chunk load, so it could have been any of them, but nothing records which test failed in
  those runs, so sharing this cause is a guess. The same PR 565 run also marked `m4-money-and-lenses.spec.ts:5` flaky
  (`create an empty one` detached during the click) and `m42-demo-trips.spec.ts:417` (the phone
  moments' shots) flaky; neither is examined here.
- **Cross-reference:** KI-2026-10-13-f (unreadable job logs); KI-2026-10-14-c (the unit job's
  equivalent).
- **First noted:** 2026-10-24, M52.
