### KI-2026-11-01-s — trip history names the Overview "Overview" while every other surface shows "Overview — <trip>"

- **Severity:** cosmetic. The history reads true of the log, and names a title the person sees nowhere else.
- **Area:** `packages/domain/src/trip/history.ts` (`describePageEvent`), `packages/pages/src/templates.ts`
  (`overviewDisplayTitle`).
- **Symptom / What happens:** since M43 part 2 (PR 662) every heading, list and link shows an unnamed
  Overview as `Overview — <trip name>`, but the trip's history describes its events from the folded,
  stored title: `Edited "Overview"`, and after a reset of a renamed Overview `Renamed "Our plan" to
  "Overview"`.
- **Why not fixed here:** not a small local change. The rule lives in `@tc/pages`, which
  `packages/domain` does not depend on, so `history.ts` would need it moved into `@tc/contracts` or
  copied. It also needs a decision the plan did not make: the trip's name as of that batch, or
  today's.
- **Fix path / Tripwire:** move `overviewDisplayTitle` (or its one comparison) to contracts, and have
  `describePageEvent` take the trip state before the batch so it can name the Overview as it read
  then. Tripwire: any change to `describePageEvent`, or a report of the mismatch.
- **Cross-reference:** M43 decision 3; review of PR 662 at `db8b246`, finding 3.
- **First noted:** 2026-11-01, review of PR 662.
