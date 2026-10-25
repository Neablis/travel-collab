### KI-2026-10-04-a — a suggestion's ghost sits where the confirmed trip has its stop, not where the board draws it — RESOLVED

- **Resolved:** 2026-10-25 (KI sweep 2). The choice this entry waited on was
  avoided rather than made: a change is still PREDICTED only on the confirmed
  trip (W5 — its outcome, staleness and *Accept all* order are untouched), but
  it is now PLACED on the trip the board draws. `placeGhosts` takes a third
  argument, `shown`, and reads its days, river and stop-to-day map from it;
  `TripProvider` passes `activeTrip`'s days and stops. A change to a stop the
  reader's unconfirmed edit removed or took off the river is listed in the
  chip instead of marking a stop nobody can see, and a move onto the day the
  reader already moved the stop to no longer says "Moving to". Reproduced
  first, red on the unchanged code: the new `TripProvider.suggest.test.tsx`
  case ("lists a change to a stop the reader's draft removed in the chip")
  failed `Expected: "no" / Received: "yes"` on the marker after the stop was
  no longer drawn, and the two new `suggestionOverlay.test.ts` cases
  ("placeGhosts on the trip the board draws") failed
  `expected true to be false`. All three green after the fix, with the rest of
  those files, `TripProvider.test.tsx`, `useTripSuggestions.test.tsx` and
  `board/suggestions.test.tsx` (144 tests); `pnpm --filter web typecheck` and
  eslint on the touched files clean.

- **Severity:** cosmetic (placement). The suggestion and its actions are
  right. Only where its ghost or marker is drawn lags, and it catches up when
  the reader's own edits are confirmed.
- **Area:** `apps/web/src/components/trip/context/TripProvider.tsx`
  (`suggestionGhosts` is `placeGhosts(trip, …)` on the confirmed trip, while
  the board draws `activeTrip`, the optimistic one);
  `apps/web/src/lib/suggestionOverlay.ts` (`placeGhosts`, whose `onRiver` and
  `dayIds` read the trip it is given).
- **Symptom / What happens:** a reader moves or removes a stop that a pending
  suggestion is about, and the edit has not been confirmed yet. That is an
  editor's unsent queue, or a suggester's own draft, which is never confirmed
  until it is sent and accepted. The suggestion's marker or ghost block stays
  where the confirmed trip has the stop. After a move it marks a place the stop
  has left. After a removal, `placeGhosts` still files the change as drawn on
  that stop, because the confirmed trip has it on a river, but the board no
  longer shows the stop. So, read from the code, the change is neither on the
  board nor in the chip until the confirmed trip catches up. A target that is gone from the *confirmed* trip is
  not this case: its prediction fails, and it is listed as "no longer applies"
  (W43).
- **Why not fixed here:** found in the review of #311 (finding 3.4) and left
  for a follow-up by decision. Placing ghosts on the optimistic trip would
  predict a suggestion on top of edits nobody has accepted. That means a second
  base, and for a suggester it means a draft's own edits deciding where
  someone else's suggestion is drawn. The fix needs that choice made first.
- **Cross-reference:** spec `docs/specs/2026-10-03-suggester-role-design.md`
  W5, W42, W46, W47, W48; ADR-064.
- **First noted:** 2026-10-04, in the review of #311.
