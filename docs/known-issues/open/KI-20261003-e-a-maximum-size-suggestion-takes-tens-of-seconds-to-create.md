### KI-2026-10-03-e — a maximum-size suggestion takes tens of seconds to create

- **Severity:** reliability. No test fails and a realistic draft is fast. A
  draft at the contract's count limits can run past a serverless time limit.
- **Area:** `apps/web/src/server/suggestions/create.ts` (`createSuggestion`'s
  dry run); `packages/domain/src/predict.ts` (`predictBatch`);
  `packages/contracts/src/suggestion.ts` (`CreateSuggestionInput`'s 100-unit,
  50-command bounds); `SetTripDates.newDayIds` in `packages/contracts/src/trip.ts`.

- **Symptom:** creating a suggestion of 100 units × 50 commands took about
  **24 s** in pure `predictBatch` with overlapping stop times, about 10 s
  without overlaps, and **27 s** end to end through
  `POST /api/trips/:tripId/suggestions`. All of it runs inside one database
  transaction. Measured while fixing the review of #308 (2026-10-03).
- **Cause:** the dry run (spec W4) predicts each unit on top of the previous
  unit's predicted trip, and each prediction rebuilds the whole trip detail.
  So the cost grows roughly with the square of the number of stops in the
  draft.
- **Why it is left:**
  - A real draft is a handful of gestures. The request-body cap (W54, 4 MiB)
    already bounds the payload.
  - The cheap fixes each change a decision, so they are Mitchell's to choose:
    lower the count bounds, dry-run without rebuilding the detail per unit, or
    move the dry run out of the transaction.
- **Related:** `SetTripDates.newDayIds` has no length bound in the contract.
  W54's byte cap bounds it indirectly.
