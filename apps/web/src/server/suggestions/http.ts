import type { SuggestionError, SuggestionErrorCode } from "./shared";

// The suggestion routes' one code → status table (W34). Exhaustive, so a code
// the module adds cannot reach a client as a default. The module decides who
// is told not-found rather than forbidden (spec W26), which is why the routes
// do not go through `requireTripAccess`: its 403 for a stranger would
// contradict it, and it would read the trip a second time.
export const SUGGESTION_STATUS: Record<SuggestionErrorCode, number> = {
  "not-found": 404,
  forbidden: 403,
  invalid: 400,
  "does-not-apply": 422,
  "dependency-pending": 409,
  "already-resolved": 409,
  "no-longer-applies": 409,
  // A row this server wrote is broken; no retry by the caller fixes it.
  "malformed-trip": 500,
  // The trip's state, not the request's rate: it clears when changes are
  // decided, not after a wait, so not 429.
  "too-many-pending": 409,
  // The change existed and is gone for good.
  expired: 410,
};

/**
 * The most a draft may weigh on the wire (spec W54). A draft is stored
 * verbatim, a sub-command the dry run skipped as a no-op included, and
 * `SetTripDates.newDayIds` has no length bound — so without this the size of
 * what is stored is whatever arrives.
 *
 * **4 MiB fits a legitimate draft at the contract's own count limits.** The
 * largest stop the app ships (the Japan scenario's transit leg with both ends
 * and a cost) is 617 bytes of JSON; 100 units of 50 of them with a full note
 * measured 3,113,021 bytes, which leaves a third again of headroom. It stays
 * under the platform's 4.5 MB request ceiling, so an oversized draft is told
 * this limit rather than the platform's. `http.test.ts` builds that draft.
 */
export const MAX_SUGGESTION_BODY_BYTES = 4 * 1024 * 1024;

/**
 * The resolve route's body is `{ "action": … }` — 21 bytes at most. Nothing of
 * it is stored, so the ceiling only refuses to read a large body for nothing.
 */
export const MAX_RESOLVE_BODY_BYTES = 1024;

/** A module refusal as the wire carries it: the message, the code, and the failing unit's index when there is one. */
export function refused({ code, message, index }: SuggestionError): Response {
  return Response.json({ error: message, code, index }, { status: SUGGESTION_STATUS[code] });
}
