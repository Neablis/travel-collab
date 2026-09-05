/**
 * "Could this string possibly name a row we wrote?" — the one predicate every
 * lookup keyed on a `uuid` column asks before it builds a query (KI-2026-09-05-x).
 *
 * **Why this exists at all.** A Next.js path segment is a `string`, and Drizzle
 * hands it to Postgres unchanged. `eq(tripDetails.tripId, "not-a-uuid")` is
 * therefore not "no rows" — it is `22P02 invalid input syntax for type uuid`,
 * a driver error that escapes the route handler and becomes a 500. Twelve
 * routes answered that way, and the board rendered Next's default 500 body —
 * the literal text "Internal Server Error" — for a mistyped or truncated
 * shared link. The bug is not that the id is unknown; it is that an unknown id
 * never got as far as being unknown.
 *
 * **Why the callers answer 404 and not 400.** A malformed id and an id that
 * names nothing are the same fact to the person holding the link: there is
 * nothing there. Answering 400 for one and 404 for the other would also make
 * the response shape a very cheap oracle — a caller could tell "that is not
 * even an id" from "that is an id you may not see", which is exactly the
 * distinction `requireTripAccess` and `readableSavedDay` go out of their way
 * NOT to leak. So the guards below sit inside the query functions and return
 * each one's own empty answer (`null`, `[]`, `not-found`), which every existing
 * caller already handles. No route gains a branch.
 *
 * **Why the canonical form and not everything Postgres accepts.** Postgres
 * also parses braced and unhyphenated variants. Every id in this system is
 * minted by `randomUUID()` and round-tripped as the canonical hyphenated form,
 * so nothing this app generates can be rejected here. Accepting the wider set
 * would mean writing a second, looser parser to keep in step with Postgres's,
 * for inputs no client of ours produces.
 */
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}
