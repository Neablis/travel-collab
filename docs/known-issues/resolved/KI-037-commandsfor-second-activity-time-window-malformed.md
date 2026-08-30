### KI-37 — `commandsFor`'s second-activity time window is malformed for any scenario with 2+ activities on a day — RESOLVED
- **Severity (as filed):** correctness (silent wrong output — same family as KI-36)
- **Area:** `packages/factories/src/commands.ts` (the `AddActivity` loop inside `commandsFor`)
- **Symptom (as filed):** the per-activity `timeWindow` was built as
  `` `0${9 + i}:00` `` for `start` — correct only for `i === 0` (`"09:00"`);
  for `i >= 1` the template produced `"010:00"`, five characters, which the
  contract's `HHMM` regex rejects, so the command came back `invalid-command`
  rather than as a wrong-but-usable time.
- **Reproduced first**, as a new `packages/factories/src/commands.test.ts` that
  runs every scenario's `commandsFor` output through the real `TripCommand`
  schema. Four of the seven scenarios failed, all on the same string:
  `threeDayTrip: {"type":"AddActivity",…,"title":"Stop 1.2","timeWindow":{"start":"010:00","end":"11:00"},…} -> [{"validation":"regex","code":"invalid_string","path":["timeWindow","start"]}]`,
  and identically for `overBudgetTrip`, `overlappingDay`, `ungeocodedTrip`.
  `emptyTrip` (no activities), `unscheduledHeavy` (1/day) and `mappedTrip`
  (its own literal `09:00`–`10:00` window) passed, exactly as the entry's
  Bounds predicted.
- **The `end` claim in the original entry was checked, not assumed, and holds.**
  `` `1${0 + i}:00` `` yields `"11:00"` at `i === 1` — valid — and only
  overflows at `i >= 10`; the largest `activitiesPerDay` any current scenario
  uses is 2, so `end` was never malformed in practice. Only `start` ever
  produced an invalid string.
- **Fix (2026-08-25):** the entry's own fix path. The inline template is
  replaced by a local `timeWindowFor(i)` that zero-pads with
  `String(hour).padStart(2, "0")`, so activity `i` of a day gets
  `09:00`–`10:00`, `10:00`–`11:00`, … The start hour is additionally capped at
  22, so no future scenario with a large `activitiesPerDay` can emit a `24:00`
  end or a start past the end of the day — the same class of latent overflow,
  closed by construction rather than left to the next caller. `mappedTrip`'s
  branch returns before this code and is untouched, so the shape
  `e2e/m10-unscheduled-rack.spec.ts` asserts on literally is unchanged.
- **Output change for consumers:** the only bytes that change are the ones that
  were invalid. `i === 0` windows are byte-identical (`09:00`–`10:00`), `end`
  is byte-identical everywhere, and `i === 1` `start` goes `"010:00"` →
  `"10:00"`. Of the three `commandsFor` call sites outside the package, two
  (`e2e/helpers.ts` → `mappedTrip`, `reset-demo-data/route.int.test.ts` →
  `unscheduledHeavy`) have byte-identical output. The third,
  `e2e/responsive.spec.ts` → `threeDayTrip`, now has its second-per-day
  `AddActivity` *accepted* where it was silently 400ing, so those trips hold
  six stops instead of three; that spec asserts only on rail/tab/sheet
  behaviour and no activity count or title, so nothing there depends on the
  old number.
- **Proof:** the reproduction above now passes — `pnpm --filter @tc/factories test`
  is 13/13 across `commands.test.ts` (8) and `trip.test.ts` (5), and
  `pnpm --filter @tc/factories typecheck` is clean. Check subset per
  `minimal-check-subset`: one file changed in one leaf package, no
  `packages/contracts` change, so the package's own typecheck + test is
  sufficient; the ~34 consumer test files were deliberately not run here (the
  serial full `pnpm check` covers them, and a parallel full run is the KI-13
  load pattern).
- **Regression test:** `packages/factories/src/commands.test.ts` (new file) —
  a `it.each` over every scenario name asserting every emitted command parses
  as a `TripCommand`, so any future scenario or field that violates the
  contract fails in the factory package itself rather than downstream, plus a
  literal assertion that a day's first two windows are `09:00`–`10:00` and
  `10:00`–`11:00`.
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8b, reset-demo-data fix wave). **Resolved:** 2026-08-25 (KI backlog pass).
