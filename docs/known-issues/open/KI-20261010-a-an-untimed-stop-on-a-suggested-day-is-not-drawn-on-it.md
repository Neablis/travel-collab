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
- **Needs Mitchell first (KI sweep 2, 2026-10-25):** still real — `placeGhosts` on a trip with
  a suggested day D holding one timed and one untimed add gave `board.days[D]: [ 'timed' ]
  offBoard: [ 'untimed' ]`, and an untimed add to a real day gave `offBoard: [ 'untimed-real' ]`.
  But the fix direction above is the "Any time" shelf Mitchell had removed in PR 269 (*"I dont
  like this 'Any time' section … they stack up and push everything down"*, `Column.tsx`): a real
  day draws no untimed stop under its river, only an "N Unscheduled" chip pointing at the rack. So
  the ghost day is consistent with a real day here, and the choice is a product one — e.g. an
  "N Unscheduled" chip on a ghost day's header that opens the suggestions chip, or untimed ghosts
  drawn in the Unscheduled rack under their day — not a fix to make unasked.
- **First noted:** 2026-10-10, M40 (while fixing suggested-day ghosts, #381).
