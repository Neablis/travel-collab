# F-C06 — The Postgres rebuild suites never issue `UpdateActivity`, so a stored `ActivityUpdated` payload's jsonb round-trip is unproven

- **Stream:** C Versioning · **Severity:** LOW (nit) · **Confidence:** CONFIRMED gap, downgraded scope (verified)
- **Area:** the five rebuild-comparing suites `commands.int.test.ts:224-277`, `anchors.int.test.ts:54-59`, `money.int.test.ts:66-69`, `projections.int.test.ts:44-49`, `cloneTrip.int.test.ts:141-144` — `grep UpdateActivity` over all five returns nothing; 14 command kinds are dispatched, never `UpdateActivity`.
- **What is wrong (and what is not):** the rebuild path for `ActivityUpdated` is `projectTripDetails → evolveTrip`, which nine domain test files cover; `applyTripEvents` (`projections.ts:24-43`) branches on only four types. So the domain semantics are covered. What no test proves is that a stored `ActivityUpdated` payload survives the Postgres jsonb round-trip through `TripEvent.parse` and rebuilds to the same `trip_details` row. Pages are outside the rebuild entirely by design (ADR-036 link 9 unbuilt; `pages.ts` is CRUD).
- **Suggested fix:** one `UpdateActivity` (changing `cost` and `kind`) added to the command sequence in `commands.int.test.ts`'s rebuild-equality case.
- **Scope of the fix:** one test file. Check subset: `commands.int.test.ts`.
- **Cross-reference:** AGENTS.md invariant 2; ADR-036 consequences ("the golden test gains a page case" — still owed at link 9).
- **Do not:** invent a `seedBoard`/`GOLDEN` helper — the first draft of this finding cited identifiers that do not exist; use the existing scenario in `commands.int.test.ts`.
