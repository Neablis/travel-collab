### KI-2026-10-28-d — Unit tests send real requests to loopback, and whether one outlives its file depends on the machine — RESOLVED

- **Severity:** reliability (tests), low. Nothing fails today. The same timing variance made
  KI-2026-10-25-w intermittent: a request that is still out when a file's jsdom is torn down can
  land on a state setter and reject with `ReferenceError: window is not defined`.
- **Area:** unit test files that mock `@/lib/apiClient` by spreading `actual` and run with no MSW
  server, so the unmocked readers send real `fetch`es to jsdom's origin (`BASE_URL`,
  `http://localhost:3001` by default), which `test-support/networkGuard.ts` lets through on
  purpose:
  - `apps/web/src/components/trip/TripHeader.test.tsx`: the cover and snapshot reads
    (`fetchTripSuggestions` was mocked in PR 627);
  - `apps/web/src/components/trip/context/TripProvider.test.tsx`: `fetchTripSuggestions`;
  - `apps/web/src/components/trip/editor/ActivityEditorSheet.test.tsx`: `fetchTripSuggestions`.

  The same kind of code, on the app side: `TripProvider.tsx`'s `onRemoteChange` (the
  `setOptimistic` after its `Promise.all`) and `reloadAccess` (the `adoptAccess` after its
  `cachedRead`) set state after an await with no mounted check, like `load` and the time-travel
  read. `useTripSuggestions` gained that check in PR 627.
- **Symptom / What happens:** measured 2026-10-28 by pointing `WEB_BASE_URL` at a local logging
  listener and running each file alone, after PR 627:
  - `TripHeader.test.tsx`: 28 requests, `GET /cover` x12, `GET /cover/search` x11,
    `GET /snapshots` x5 (29 before PR 627, with one `GET /suggestions`);
  - `TripProvider.test.tsx`: 1, `GET /suggestions`;
  - `ActivityEditorSheet.test.tsx`: 2, `GET /suggestions`.

  On a developer machine with `pnpm dev` on 3001 these reach the developer's own server; in CI
  they meet ECONNREFUSED. How long they take, and so whether they outlive the file, depends on
  which.
- **Why not fixed here:** PR 627 closed KI-2026-10-25-w's own trigger (the suggestions read in
  `TripHeader.test.tsx`, and the hook's late state updates). The cover, snapshot and cover-probe
  readers already drop a late answer (`useTripCover.ts`, `SnapshotList.tsx`, `CoverPicker.tsx`),
  and in every unit file that renders the provider without MSW the provider's own callees are
  `vi.fn` mocks that resolve at once, so none of this is a reproduced failure. Mocking them, or
  guarding the provider, is its own change with its own reproduction.
- **Fix path / Tripwire:** mock the remaining readers in those files (or give them an MSW server
  with `onUnhandledRequest: "error"`), then consider making the network guard refuse loopback to
  jsdom's own origin in unit tests so a new one is loud. For the provider, a mounted ref checked
  after each await, as `useTripSuggestions` has. If the unit job goes red again on an
  unattributed `window is not defined` after every file passed, start here.
- **Cross-reference:** KI-2026-10-25-w (resolved by PR 627); PR 627's review, findings 1 and 2.
- **First noted:** 2026-10-28, review of PR 627 at `353002a`; counts re-measured on the fix branch.
- **Resolved, 2026-10-28 (KI sweep, unit-test hygiene):**
  - **Reproduced** as the entry did: `WEB_BASE_URL` pointed at a local logging listener, each file
    run alone. `TripHeader.test.tsx` 28 requests (`/cover` x12, `/cover/search` x11, `/snapshots`
    x5), `TripProvider.test.tsx` 1 (`/suggestions`), `ActivityEditorSheet.test.tsx` 2
    (`/suggestions`). After the stubs: 0, 0, 0, with 40, 81 and 45 tests passing.
  - **Stubs.** `TripHeader.test.tsx` mocks `fetchTripCover`, `searchTripCovers` and
    `fetchTripSnapshots`; `TripProvider.test.tsx` and `ActivityEditorSheet.test.tsx` mock
    `fetchTripSuggestions`.
  - **Provider.** `TripProvider.tsx` holds a `mounted` ref, cleared on unmount, and
    `onRemoteChange` (after its `Promise.all`) and `reloadAccess` (after its `cachedRead`) return
    before setting state when it is clear. Regression tests in `TripProvider.test.tsx`: *"sets
    nothing when a remote change's refetch answers after the page is gone"* and *"sets nothing when
    an access re-read answers after the page is gone"*. Each holds the read, unmounts, takes `window`
    away and releases it. Before the fix both failed with `expected [ ReferenceError { "message":
    "window is not defined" } ] to deeply equal []`. With only one guard removed, only its own test
    fails.
  - **Guard.** `networkGuard.ts` gained `refuseOwnOrigin` / `installOwnOriginGuard`, installed by
    the unit lane's `vitest.setup.ts` only (the integration lane is untouched). A `fetch` to an
    absolute URL on the jsdom page's origin rejects with a message naming it and is recorded, and
    the setup's `afterEach` and `afterAll` fail the test or file that sent it. Relative URLs are let
    through, because Node's `fetch` rejects them at once without sending anything. MSW-handled
    requests never reach it. Proof: with `fetchTripSuggestions` unmocked again in
    `ActivityEditorSheet.test.tsx`, *"derives the time window from start plus duration"* failed with
    `Error: This test sent 1 request(s) to the test page's own origin, which a unit test has no
    server for. … http://localhost:3001/api/trips/10000000-…/suggestions`. Of four timed runs, three
    sent the request and every one of those failed. The fourth sent none, because the idle read
    never fired before unmount: the timing this entry describes. `networkGuard.jsdom.test.ts` covers the
    refusal and the pass-through. With the install commented out, its refusal test fails with
    `got 'fetch failed'`.
  - **Every other file the guard caught.** One full unit run with the guard on (before the
    absolute-only rule) failed 13 files. Eight of them were relative-URL fetches that never left the
    process, and the absolute-only rule drops those. The other five sent real requests and are now
    stubbed:
    - `MapHoverCard.test.tsx`, `/api/account/preferences`: `PreferencesProvider noSessionCookie`.
    - `OverviewLens.test.tsx`, `/access` x7: `fetchTripAccess` mocked.
    - `WidgetSettings.test.tsx`, `/weather`: `fetchTripWeather` mocked.
    - `noRawSyntax.test.tsx`, `/weather` and `/pages`: `fetchTripWeather` and `fetchPages` mocked.
    - `TripHeader.cover.test.tsx`, `/api/auth/session`, `/events` and `/suggestions`: MSW
      `bypass` resolved them to absolute URLs and sent them. They are now initial MSW handlers.

    Each mock answers with the network error CI saw. A second full run passed 510/510 files and
    7295 tests, with no request refused.
  - **Not covered:** a request sent after a file's `afterAll` is still refused, so it sends
    nothing, but it fails no test. jsdom's XHR and `WebSocket` to the page's own origin are not
    refused (nothing in `src/` sends either there).
