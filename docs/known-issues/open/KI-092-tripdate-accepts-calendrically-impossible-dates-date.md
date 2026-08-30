### KI-92 — `TripDate` accepts calendrically impossible dates, so the date parsers can only reject them by throwing
- **Severity:** correctness (a validation gap; its symptom today is a 500 where a 400 belongs)
- **Area:** `packages/contracts/src/trip.ts` (`TripDate`), `packages/domain/src/trip/decide.ts` (`SetTripDates`)
- **What is wrong:** `TripDate` validates SHAPE only — `/^\d{4}-\d{2}-\d{2}$/` — with no calendar-range check, so `"2026-02-30"`, `"2027-02-29"` and `"2026-13-45"` all parse as valid trip dates. Shape is not calendar validity, and nothing between the API boundary and the date math closes the gap.
- **The command pipeline is already closed (2026-08-29, PR #84).** `decide.ts` rejects a non-calendar date on both `SetTripStartDate` and `SetTripDates` with `invalid-dates`, via `isCalendarDate` exported from `packages/domain/src/trip/dates.ts`. That was not optional polish: KI-73's strict parse means a *persisted* impossible start date makes `deriveDayDates` throw on every projection, i.e. a trip that can never be read back, so without this guard the strictness would have traded silently-wrong dates for an unloadable trip.
- **What is still open is the contract itself.** `TripDate` continues to accept the value, so every future consumer re-inherits the gap and the domain's `RangeError` remains reachable by any path that does not go through `decide.ts`. The close is a `.refine` on `TripDate`, which makes the impossible date unrepresentable at the boundary and turns the domain's throw back into an assertion nobody can trigger. That is a genuine contract change — AGENTS.md invariant 5 makes it its own reviewed step, with the changelog entry and consumer sweep that implies — which is why KI-73 was closed without it.
- **Reachability:** the UI cannot produce such a date (`<input type="date">` will not emit one) and `NewTripWizard` gates on `ISO_DATE.test` first, so this needs a crafted API request. Latent, not live.
- **Cross-reference:** KI-73 (resolved 2026-08-29 — this is the half it explicitly could not take).
- **First noted:** 2026-08-29 (KI cluster, while converging the parsers).


- **Numbering:** filed as 77 on 2026-08-29, when several sibling branches each filed a different KI-77 the same night. Renumbered to 92 on merge. Nothing outside this file references it.
