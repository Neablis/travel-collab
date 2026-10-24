### KI-2026-10-24-f — `TripBoardScreen.test.tsx` logs MSW "unhandled request" warnings for `/chat` and `/chat/read`

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
