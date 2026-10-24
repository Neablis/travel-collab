### KI-2026-10-19-a — Closing Trip settings leaves `?settings=` in the router, so the next tab switch writes it back and a reload reopens the sheet — RESOLVED

- **Severity:** correctness, minor. Nothing is lost. A sheet the reader closed comes back on a
  reload, or in a link they copy, after any tab switch.
- **Area:**
  - `apps/web/src/components/trip/TripHeader.tsx`, the settings sheet's `onOpenChange`
    (`window.history.replaceState(window.history.state, …)`, around line 752).
  - `apps/web/src/components/trip/context/LensRouter.tsx`, `setView`, which rebuilds the URL from
    `useSearchParams()`.
  - `apps/web/src/lib/tripSettingsLink.ts`.
- **Symptom / What happens:**
  1. Open a trip from a `?settings=people|cover` link (Home's *Invite who's coming* or *Choose a
     cover photo*), or with that param added by hand.
  2. Close the sheet. The address bar drops `settings`.
  3. Switch tab (Plan, Map…). `settings=` is back in the address bar.
  4. Reload or share that URL: Trip settings opens again.
- **Cause:** read in Next 16.4.2's `next/dist/client/components/app-router.js`, lines 302–310. The
  patched `history.replaceState` returns early, without syncing the router's URL, when its `data`
  carries `__NA` or `_N`; it treats that call as Next's own. `window.history.state` on an
  app-router page always carries `__NA`. So the close call changes the address bar but not
  `useSearchParams()`. `setView` then builds `new URLSearchParams(params)` from the stale params,
  `settings` included. The comment at the call ("The native call, which Next's router observes")
  is the wrong belief behind the bug. `setView` itself has passed `null` since PR 486, which is
  why its own changes do sync.
- **Reproduced:** not yet in a browser. It was found by PR 486's review, reasoned from the code
  and from Next's source. The first step of the fix is a test that fails today:
  - **Unit:** render the board with `?settings=people`, close the sheet, call `setView("Plan")`,
    assert the URL has no `settings`. The test needs `test-support/nextHistory.ts`'s
    `followHistory`, which mirrors Next's `__NA` skip since PR 486.
  - **Or e2e:** the same steps, then `page.reload()` and assert the sheet is closed.
- **Fix direction:** pass `null` as the state at `TripHeader.tsx`'s call, the way `setView` and
  `PhoneTabBar` do since PR 486. Fix the comment beside it. Belt and braces, optional:
  `n.delete("settings")` in `setView`, since a tab switch never means to open settings.
- **Same pattern, check while there (not known bugs):**
  - `components/playbooks/DiscoverScreen.tsx:268`: its comment says "Next syncs the native
    history API into its router", which is untrue for this call. The screen reads its filters
    from state, not `useSearchParams`, so the visible effect is probably nil. But Next's idea of
    the URL is stale, which matters to a later router navigation or Back.
  - `components/admin/AccountsPanel.tsx:168`: its comment shows it knows Next "reads [this] as a
    restore". Confirm that is the intent before touching it.
- **Cross-reference:** PR 486 (moved `setView` and the phone tab bar to `replaceState(null, …)`
  and added `followHistory`). M37 (the `?settings=` links). ADR-068 (one opener for Trip
  settings).
- **First noted:** 2026-10-18, PR 486's review of eea2034. Filed 2026-10-19 after both parts
  merged.
- **Proof (resolved 2026-10-24, KI sweep):** the fix direction, as written: `TripHeader.tsx`'s
  close passes `null` as the state, and its comment now says why. The optional `setView`
  belt and braces was left out, so the test guards the cause rather than a second line.
  Confirmed in Next 16.4.2's `app-router.js` (lines 302–308: `if (data?.__NA || data?._N)`
  returns before the sync). Reproduced first, as the unit test the entry describes: the new
  `TripBoardScreen.test.tsx` case *forgets a ?settings= link once the sheet closes, so a tab
  switch does not bring it back* seeds the history state with `__NA`, opens from
  `?view=Plan&settings=people`, closes the sheet and clicks Map. On the old code it failed with
  `expected '/trips/x?view=Map&settings=people' to be '/trips/x?view=Map'`; with the fix
  `TripBoardScreen.test.tsx` and `TripHeader.test.tsx` pass (175/175 with `phoneTouch.test.tsx`).
  Of the "same pattern" checks: `DiscoverScreen.tsx`'s filter write had the bug too and is
  fixed in the same sweep (its own red-first test). `AccountsPanel.tsx:168` was not touched.
