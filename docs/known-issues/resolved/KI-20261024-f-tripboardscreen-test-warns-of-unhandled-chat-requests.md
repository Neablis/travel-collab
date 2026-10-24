### KI-2026-10-24-f — `TripBoardScreen.test.tsx` logs MSW "unhandled request" warnings for `/chat` and `/chat/read` — RESOLVED

- **Severity:** cleanup. The tests pass. The warnings bury a real one, and a request no handler
  answers is a state the test did not mean to set up.
- **Area:** `apps/web/src/components/board/TripBoardScreen.test.tsx`; the handlers at
  `apps/web/src/mocks/handlers.ts` (`GET`/`POST /api/trips/:tripId/chat`,
  `POST /api/trips/:tripId/chat/read`).
- **Symptom / What happens:** a run of the file prints MSW warnings for unhandled
  `GET /api/trips/<id>/chat` and `POST /api/trips/<id>/chat/read`. M52 parts 6 and 8 made the
  board read the chat on more paths (the *Trip chat* card, the unread count), so cases whose
  server setup has no chat handlers now reach them.
- **Why not fixed here:** prose-only part 0. Fix: give the cases that reach the chat a handler
  (or the shared default), and consider `onUnhandledRequest: "error"` for this file so a new
  unhandled read fails instead of warning.
- **Cross-reference:** KI-2026-10-14-c (this file's *carries the unread count* red, appended
  there).
- **First noted:** 2026-10-24, M52.
- **Resolved, 2026-10-24 (KI sweep):** **not reproducible as filed on current `main`**: with an
  `onUnhandledRequest` callback recording every unhandled request (checked to fire with a probe
  `fetch` of `/api/nothing`), all 128 tests ran with none. `makeTripHandlers` has carried
  `makeChatHandlers` by default since PR 488, and the file has changed by 188 lines since this
  entry's commit, so later PR 537 rounds evidently covered the cases that reached the chat bare;
  which one was not bisected. The mechanism is real, and reproduced by removing the default chat
  handlers (reverted): six `[MSW] Error: intercepted a request without a matching request
  handler: GET /api/trips/<id>/chat` prints with only the 2 chat-specific tests failing, because
  `"error"` mode only prints and the board swallows the failed read. **Fix (test only):** the
  file's `onUnhandledRequest` records each unhandled request and `afterEach` asserts there were
  none, so a new one fails its test instead of printing. **Proof:** with the chat handlers
  removed, `Tests 9 failed | 119 passed (128)`, each new red being `requests no handler answered:
  … + "GET /api/trips/<id>/chat"`; restored, `Tests 128 passed (128)` with no MSW prints.
