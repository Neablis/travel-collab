import type { SnapshotError, SnapshotErrorCode } from "./snapshots";

// The snapshot routes' one code → status table. Exhaustive, so a code the
// module adds cannot reach a client as a default. Like the suggestion routes,
// these do not go through `requireTripAccess`: the module asks the access seam
// itself, and answers a stranger `not-found` rather than its 403.
const SNAPSHOT_STATUS: Record<SnapshotErrorCode, number> = {
  "not-found": 404,
  forbidden: 403,
  // The trip's state, not the request's: each clears when the trip changes.
  "trip-deleted": 409,
  "too-many-snapshots": 409,
  "no-op": 409,
  "concurrency-conflict": 409,
  "restore-refused": 409,
  // A row this server wrote is broken; no retry by the caller fixes it.
  "malformed-trip": 500,
};

/** The snapshot bodies are `{ "name": … }`, 80 characters at most; this only refuses to read a large one for nothing. */
export const MAX_SNAPSHOT_BODY_BYTES = 1024;

/** A module refusal as the wire carries it: the message and the code. */
export function refused({ code, message }: SnapshotError): Response {
  return Response.json({ error: message, code }, { status: SNAPSHOT_STATUS[code] });
}
