### KI-2026-10-05-h — a removed member's open page still shows the whole trip (only its chat says access is gone), and a reload shows a bare `forbidden`

- **Severity:** cosmetic and confusing, low reach. Nothing leaks after removal: the server refuses
  every read and write the removed person makes. Their open page just goes on looking like the
  trip.
- **Area:** `apps/web/src/components/board/TripBoardScreen.tsx` (`accessLost` from `useTrip()`,
  which reaches only `useTripChat`, and the `status === "error"` branch that renders
  `error ?? "Something went wrong"` and "← Your trips"); `TripProvider.tsx` (`accessLost`,
  set by the events poll's `onRefused`).
- **What closed (M46 D2, `200f220`, 2026-10-13):** the page now learns it was removed. A 403 on
  the events poll sets `useTrip().accessLost` (`onRefused` in `broadcast.ts`). Test:
  `TripProvider.test.tsx` › "reports access lost when the poll is refused with a 403". The chat
  panel then shows `NO_ACCESS_LINE` ("You no longer have access to this trip") instead of looking
  live (`useTripChat.ts`, status `no-access`).
- **Symptom / what is still open** (re-checked in the tree on 2026-10-17; this was not walked in a
  browser again):
  1. Outside the chat, nothing reads `accessLost`. The one exception is the rail button, which
     falls back to Ask alone (`hasChat`). After the owner removes them, the member's board,
     Trip settings and People list carry on as before, themselves still listed.
  2. On reload, the page reads a bare `forbidden` with only "← Your trips" below it. This
     predates M35 and M46: the trip page route was in neither diff.
- **Likely fix:** let the board read `accessLost` and replace the trip with one designed "you are
  not on this trip any more" state with a link home. Give the reload's refused read the same
  state.
- **Cross-reference:** M35 (`docs/milestones/M35-travellers-and-people.md`), spec D11, W19; M46
  D2 (`docs/milestones/M46-a-trip-has-a-conversation.md`, which kept this open "unless its fix is
  cheap").
- **First noted:** 2026-10-05, M35 preview walk at `edaad30` (PR #335). Narrowed on 2026-10-17
  (the 2026-10-16 audit, §6, called it likely resolved; only the chat half is).
