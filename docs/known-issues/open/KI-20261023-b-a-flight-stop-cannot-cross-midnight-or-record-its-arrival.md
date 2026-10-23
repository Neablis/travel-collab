### KI-2026-10-23-b — A flight stop cannot cross midnight or record its arrival

- **Severity:** correctness. A red-eye cannot be entered as it is, and no flight can say when it lands.
- **Area:**
  - `packages/contracts/src/activity.ts:9` (`TimeWindow`): the refine `start < end` refuses any
    window that ends on a later day, on every write path (the board, the assistant, the public
    API, content bundles).
  - `apps/web/src/components/board/ActivityEditor.tsx` (`build()`): edit mode refuses
    `end <= start` ("End time must be after start time"); create mode saves start plus *How long*,
    clamped to 23:59 by `toTimeString` (`apps/web/src/lib/time.ts`, `DAY_END_MIN`).
  - `packages/pages/src/macros/primitives/flights.ts` (`trip.flights`, *Your flights*): shows no
    arrival because of the two above.
- **Symptom / What happens:** a stop's time window is same-day. A 22:00 flight from Lisbon to
  Tokyo, landing 07:00 the next day, can only be saved ending by 23:59, and a flight added through
  *Add your flight* gets an end derived from *How long*, which nobody typed. So the window's end
  is not an arrival, and the M52 flights widget (PR 536, review round 3) shows the departure, the
  destination and the countdown, and no arrival. *Now and next* also treats the flight as over at
  its window's end (ADR-080 decision 1's rule for every stop).
- **Why not fixed here:** recording an arrival is a contract change (a new field, or a window that
  may cross midnight), replayed forever (invariants 1, 2 and 5). PR 536 is a widget part with no
  contracts change.
- **Fix direction:** most likely M44's `booking` object (M44 decisions 1–2, moved to M52 decision
  5 on 2026-10-22): an optional arrival time with a day offset ("+1 day") on a flight, read as the
  time where it lands. Then `trip.flights` can show it beside the destination, and *Add your
  flight* can ask for it. Keep `TimeWindow` same-day unless a decision says otherwise.
- **Cross-reference:** M52 decision 15; M44 decisions 1–2; ADR-080 decision 1; PR 536.
- **First noted:** 2026-10-23, review of M52 part 7, round 3.
