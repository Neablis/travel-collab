### KI-2026-10-28-d — Unit tests send real requests to loopback, and whether one outlives its file depends on the machine

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
