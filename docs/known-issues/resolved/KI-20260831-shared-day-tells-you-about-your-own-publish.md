### KI-20260831 — Publishing your own day tells you someone else changed it — RESOLVED
- **Severity:** cleanup (no data is wrong; the app reports a change to the person who made it)
- **Area:** `apps/web/src/components/playbooks/SharedDayScreen.tsx`, `apps/web/src/components/playbooks/useLibraryRead.ts`

- **What happens (2026-08-31, found while fixing pull request 102's review):**
  publish or withdraw your own saved day from the shared-day route and the
  screen answers with the external-change banner — *"its author published,
  withdrew or someone took it"* — about the button you just pressed.

- **Mechanism.** `setVisibility()` calls `feed.reload()` on success.
  `useLibraryRead`'s signature for this screen is `${visibility}:${adds}`, and
  `reload()` deliberately KEEPS its baseline so that a same-query re-read can
  still detect a genuine external change. Publishing changes `visibility`, so
  the comparison fires. Both halves are behaving as designed; the gap is that
  the hook cannot tell a **self-initiated** reload from a polling one.

- **Same species as the filter-change bug fixed on pull request 102**, and found
  by the same review. That one was a *query* change misread as a library
  change; this one is a *self-inflicted* change misread the same way. The fix
  there — resetting the baseline when `read` changes identity — does not reach
  this, because `reload()` does not change `read`, and must not: that is what
  makes the banner work at all.

- **Fix path — needs a hook API decision, which is why it is filed rather than
  fixed.** `useLibraryRead` needs a way to say "this reload is mine, do not
  compare": a `reload({ silent: true })` option, a separate
  `refreshWithoutComparing()`, or having the caller re-baseline explicitly
  after a write it initiated. All three change a shared hook used by three
  screens, so it is not a review-round fix. Whichever is chosen needs a test
  that a **genuine** external change still raises the banner afterwards —
  otherwise the fix silently disables the feature.

- **Not the same as:** Discover's `LibraryMoved`, which after pull request 102 is
  **unreachable** rather than wrong — Discover re-reads only when the query
  changes. The component is kept there deliberately (it is the shared
  project-rule-6 pair, and deleting a designed state is a gate conversation),
  and its test pins that behaviour. Do not conflate "unreachable" with "broken".

- **RESOLVED 2026-09-02, by the `refreshWithoutComparing()` option this entry
  listed second.**

  **Reproduced first, at the screen.** A new case in `SharedDayScreen.test.tsx`
  renders the author's own private day, clicks Publish, and lets the re-read
  come back as published — the sequence the entry describes. On unmodified
  `main`:

  ```
   FAIL  |jsdom| src/components/playbooks/SharedDayScreen.test.tsx >
     a shared day > does not report your own publish as somebody else changing the day
  AssertionError: expected <div role="status" …(2)>…(3)</div> to be null
  + Received:
  <div ... data-testid="library-moved" role="status">
    This day has changed since you opened it — its author published, withdrew or someone took it.
  ```

  **The fix.** `useLibraryRead`'s internal `run` takes a `compare` flag;
  `reload()` passes `true` and the new `refreshWithoutComparing()` passes
  `false`. `SharedDayScreen.setVisibility` calls the latter on success. A
  separate call rather than `reload({ silent: true })`, because `reload` is
  handed straight to `onClick` in `ReadStates.tsx` and in this screen's
  not-readable state, where an options parameter would silently receive a
  `MouseEvent`. The other three consumers (Discover, the profile, the board)
  are untouched — none of them writes.

  **The baseline still moves on a silent refresh.** That is the line the fix
  turns on: `onScreen.current = next` stays outside the `compare` guard, so a
  self-initiated read becomes the new reference point and the very next genuine
  external change is measured against it. Keeping the old signature would have
  deferred the false banner by one read rather than removing it.

  **Proven, including the half the entry asked for.** Four regression tests:
  the screen-level one above now asserts *both* that your own publish is silent
  **and** that a subsequent real change (somebody takes the day into a trip, the
  `AddToTripDialog` 404 path) still raises the banner; three at the hook level
  in `useLibraryRead.test.tsx` pin the silence, the genuine change after a
  silent refresh, and that the caller's own write is not re-reported on the next
  reload. That last one was mutation-checked — moving `onScreen.current = next`
  inside the guard turns it red and leaves the other 27 green, so it really does
  guard the load-bearing line.

  **Checks run** (narrow subset; `apps/web` only, no contracts file touched):
  `pnpm --filter web typecheck` clean; `eslint` on the four touched files
  clean; `vitest run -c vitest.unit.config.ts` over `SharedDayScreen`,
  `useLibraryRead`, `DiscoverScreen`, `ProfileScreen` and `LeaderboardScreen`
  — the hook and all four of its consumers — `Test Files 5 passed (5)`,
  `Tests 72 passed (72)`. Node 22, per KI-2026-09-02-a.

  **Noticed and left alone:** `handleDelete`'s failure path still uses the
  comparing `reload()`, deliberately — a refused delete means the day is
  published while this page believed it private, which is somebody else's edit
  arriving and exactly what the banner is for. `AddToTripDialog`'s `onConflict`
  likewise. Both are documented in place.
