### KI-2026-10-28-c — a stranger can tell a trip whose stored doc will not parse from a missing one

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
