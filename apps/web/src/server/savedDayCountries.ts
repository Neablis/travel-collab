// The country rule's crossing into `apps/web`, for the reason and on the terms
// `savedDayCities.ts` sets out for the city rule: a maintenance script may not
// import `packages/domain` (AGENTS.md's architecture map), and `scripts/**` is
// outside the lint wall that would catch it, so the script imports this bridge
// instead. Its one script caller is the `countries` backfill.
//
// EXPLICIT file extensions and no `@/` alias, for plain Node's ESM resolver —
// see `savedDayCities.ts`.
import { countriesOfStops } from "../../../../packages/domain/src/trip/cities.ts";
import type { SavedStop } from "@tc/contracts";

/**
 * The countries a saved day covers, as uppercase ISO-3166 alpha-2 codes.
 *
 * A thin re-export of the domain's rule, and the same function `newSavedDayRow`
 * calls at save time — so a backfilled row and a freshly saved one cannot hold
 * different arrays for the same stops.
 */
export function savedDayCountries(stops: readonly SavedStop[]): string[] {
  return countriesOfStops(stops);
}
