import type { TripDetail, TripRole } from "@tc/contracts";
import { requireTripAccess, type TripAccessOptions } from "@/server/access/trip-access";

// Explicit return type: without it, TS infers complementary optional keys
// (`{ error: Response; userId?: undefined; detail?: undefined } | { userId: string; detail: TripDetail; error?: undefined }`)
// on the union, which defeats `"error" in g` narrowing under strict mode.
//
// `detail` is included on success because `guard()` already fetches it
// internally to check membership — callers that also need the trip detail
// (e.g. the AI route) can reuse it instead of re-fetching. Callers that only
// need `userId` (the pages CRUD routes) simply ignore the extra field.
type GuardResult = { error: Response } | { userId: string; role: TripRole; detail: TripDetail };

/**
 * `minimum` is REQUIRED, and that is the whole point of this signature.
 *
 * Until M11 link 3 this function checked membership with no role at all, and
 * it fronts both the Notebook page-write routes and the AI handler — so the
 * first `viewer` the invite flow created would have been able to write pages
 * and drive the assistant on a trip they may only read. A viewer is read-only
 * everywhere: reads pass `"viewer"`, every write and the assistant pass
 * `"editor"`. Making the parameter required means the next route that calls
 * this cannot inherit the old default by forgetting to think about it.
 */
export async function guard(
  tripId: string,
  minimum: TripRole,
  options: TripAccessOptions = {},
): Promise<GuardResult> {
  return requireTripAccess(tripId, minimum, options);
}
