### KI-2026-10-28-c — a stranger can tell a trip whose stored doc will not parse from a missing one — RESOLVED

- **Severity:** correctness, minor. It confirms that a trip id exists to someone who may not read
  it. The stranger cannot cause the condition, only observe it, and it needs a stored doc that
  already fails to parse.
- **Area:** `apps/web/src/server/access/trip-access.ts` (`readTrip`), and `getTripDetail` in
  `apps/web/src/server/projections.ts`, which throws on a stored doc it cannot parse.
- **Symptom / What happens:** a caller who is not a member asks for a trip whose stored
  `trip_details.doc` fails `TripDetail`. `getTripDetail` throws a ZodError, and `readTrip`
  answers `malformed-trip` before `mayRead` runs. v1 answers that with a 500 `server-error`
  ("This trip could not be read. The failure has been logged."), and MCP passes it through, while
  an id that does not exist gets `not-found`. The BFF has the same difference.
- **Why not fixed here:** found while reviewing PR 626 (M55 part 11), which hides only
  `forbidden`; this behaviour predates it. The order is the one KI-2026-09-05-r introduced, and
  changing it touches every trip read. The fix: read the doc's members without the full parse,
  decide `mayRead`, then parse; a stranger then gets `forbidden` (and over MCP, `not-found`).
- **Cross-reference:** KI-2026-09-05-r (resolved; made `getTripDetail` parse and throw). M55
  part 11 (PR 626) hides a stranger's `forbidden` over MCP.
- **First noted:** 2026-10-28, re-review of PR 626 at 3d26f90.
- **Reproduced before fixing:** two tests storing a doc whose `name` is `7`, members intact.
  `apps/web/src/server/access/trip-access.int.test.ts` (BFF): `AssertionError: expected 500 to be
  403` for the stranger. `apps/web/src/server/mcp/dispatch.int.test.ts` (MCP `get_trip`): the
  stranger got `"This trip could not be read. The failure has been logged. (server-error)"` where
  a missing id gets `"No such trip. (not-found)"`.
- **Fix (2026-10-28):** `readTrip` in `access/trip-access.ts` no longer answers `malformed-trip`
  straight from `getTripDetail`'s ZodError: it reads the doc's members without the full parse
  (new `getStoredTripMembers` in `projections.ts`, each entry kept only if it parses as a
  `TripMember`), overlays the granted members as usual, and answers `malformed-trip` only if
  `mayRead` passes, `forbidden` otherwise (so `not-found` over MCP). The healthy path is
  unchanged: the extra read happens only after a failed parse. **One consequence, deliberate:** a
  doc whose `members` is itself unreadable leaves only the granted members, so its log owner is
  told `forbidden` rather than `malformed-trip`; telling a possible stranger is the worse error.
  Two existing fixtures stored `{ tripId, name: 7 }`, with no members, and asserted the owner's
  `malformed-trip`; both now keep the owner in `members` (`suggestions/suggestions.int.test.ts`,
  `public-api/route.int.test.ts`), their assertions unchanged. **Proof:** both new tests pass, the
  BFF one also asserting the log owner and a granted member still get 500; the int lane over
  `server/access`, `server/mcp`, `server/public-api`, `server/snapshots`, `server/suggestions`,
  `server/projections`, `app/api/v1`, `app/api/mcp`, `app/api/trips` and `app/api/invites` passes.
  **Resolved:** 2026-10-28.
