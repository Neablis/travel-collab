### KI-2026-10-10-a — an untimed stop suggested onto a suggested new day is not drawn on that day

- **Severity:** minor. Nothing is lost or mis-applied; the change is only harder to see.
- **Area:** `apps/web/src/lib/suggestionOverlay.ts` (`offBoard`: "trip fields, days, the rack,
  untimed stops") and `apps/web/src/components/board/GhostDayColumn.tsx`.
- **Symptom:** a suggester (or the assistant, ADR-067) adds a day and puts a stop with no time
  window on it. The ghost day column (W79) is drawn but empty for that stop: the river draws stops
  by time, so an untimed one goes to `offBoard` and is listed only in the suggestions chip. Timed
  stops on the same ghost day are drawn. *Accept all* applies the untimed stop correctly.
- **Why not fixed here:** the fix for Mitchell's preview walk (#381) covered the timed case he hit.
  Real days have the same limit for any untimed ghost, so the right fix is shared, not ghost-day only.
- **Fix direction:** give a day column (real and ghost) an "any time" shelf under its river that
  draws untimed ghosts for that day, and route an untimed add or move into `board.days` for its
  day instead of `offBoard`. Same gap, lower priority: the Calendar view draws no ghost days, and a
  `SetTripDates` that lengthens the trip gets no ghost days (`suggestionOverlay.ts` :67).
- **First noted:** 2026-10-10, M40 (while fixing suggested-day ghosts, #381).
