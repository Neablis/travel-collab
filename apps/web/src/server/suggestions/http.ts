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
};

/** A module refusal as the wire carries it: the message, the code, and the failing unit's index when there is one. */
export function refused({ code, message, index }: SuggestionError): Response {
  return Response.json({ error: message, code, index }, { status: SUGGESTION_STATUS[code] });
}
