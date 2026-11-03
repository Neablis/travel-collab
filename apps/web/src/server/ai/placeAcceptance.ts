// **Whether a geocoder's answer is the place we asked about — one rule, for
// every path that looks a stop up by name.**
//
// Two resolvers grew apart. The assistant's enrichment (`geocodeEnrichment.ts`,
// KI-15) accepted a match only where it agreed with the trip's region or the
// model's own coordinates. The v1 stop writes (`public-api/locations.ts`) took
// the vendor's top hit unchecked, and Ria's Wines was pinned in Atlanta
// (KI-2026-11-03). And neither consulted the name check written for exactly the
// wrong-venue-inside-the-right-box case (`placeNameVerdict`, KI-39), so Kegon
// Falls became Urami Falls and was reported verified (KI-2026-09-20-a).
//
// So the acceptance rule lives here, and both resolvers call it. It is pure: no
// vendor, no quota, no I/O. What each caller DOES with a refusal stays the
// caller's, because the two differ for good reasons (a batch with a report and
// a city fallback, against one write with a response header).
//
// Kept beside `geocodeNameMatch.ts` rather than under `server/geocoding/`,
// which stays a pure vendor seam; that file's region arithmetic is imported,
// not repeated.
import type { Location } from "@tc/contracts";
import type { GeocodeResult } from "@/server/geocoding";
import { boundingBoxAround, distanceKm, withinBox, type BoundingBox, type LatLng } from "@/server/geocoding/region";
import { placeNameVerdict } from "./geocodeNameMatch";

/**
 * How far a match may sit from coordinates we already hold for the place and
 * still count as the same place, located more precisely. Generous enough for a
 * vaguely placed restaurant inside a metro area, nowhere near enough to cross
 * an ocean.
 */
export const MAX_REFINE_KM = 50;

/**
 * Padding around a single coordinate hint when it biases the lookup. Tight,
 * because it describes one place, where `TRIP_REGION_MARGIN_KM` is loose
 * because a trip spans a region.
 */
const HINT_MARGIN_KM = 50;

/**
 * What we believed about where the place is before asking.
 *
 * `hint` is coordinates already held for this place (the model's own, when
 * plausible). `region` is independent evidence of where the trip is: its
 * located stops, or what a batch has settled so far.
 */
export interface PlaceBelief {
  hint: LatLng | null;
  region: BoundingBox | null;
}

/**
 * The name to compare a candidate with, and the geography that cannot tell two
 * venues apart.
 *
 * A stop's name often carries its own geography: "Kegon Falls, Chūzenji,
 * Nikkō". Only the part before the first comma names the venue; the rest joins
 * the stop's city, area and postal locality as context, which
 * `distinctiveTokens` drops from what the candidate has to match. Without that
 * split, a correct "Kegon Falls" candidate would be refused for not containing
 * "Nikkō".
 */
export interface NameQuery {
  place: string;
  context: string[];
}

/** A location's `NameQuery`: its name up to the first comma, and every other piece of geography it carries. */
export function nameQueryOf(location: Pick<Location, "name" | "city" | "area" | "address">): NameQuery {
  const [place = "", ...tail] = location.name.split(",").map((part) => part.trim());
  const context = [
    ...tail,
    location.area,
    location.city,
    location.address?.dependentLocality,
    location.address?.locality,
    location.address?.administrativeArea,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return { place, context };
}

/**
 * Whether a hint can be trusted for this lookup: it can unless it sits outside
 * the region.
 *
 * A hint outside the region is not discarded (a caller may still keep it as its
 * fallback). It only loses the right to bias the search or validate a match on
 * its own authority: center the search on a wrong hint and "top result near the
 * hint" stops being evidence of anything (KI-15).
 */
function hintTrusted(belief: PlaceBelief): belief is PlaceBelief & { hint: LatLng } {
  return belief.hint != null && (belief.region == null || withinBox(belief.region, belief.hint));
}

/** The box to bias the lookup with: tight around a trusted hint, else the region, else none. */
export function lookupViewbox(belief: PlaceBelief): BoundingBox | null {
  return hintTrusted(belief) ? boundingBoxAround([belief.hint], HINT_MARGIN_KM) : belief.region;
}

/**
 * The verdict on one candidate.
 *
 * - `agrees`: it sits where we believed the place to be, and its name does not
 *   disagree with ours.
 * - `unchecked`: there was nothing to check its position against (no trusted
 *   hint, no region), and its name does not disagree. A caller may take it, but
 *   must not call it verified.
 * - `wrong-place`: it sits outside the region, or too far from a trusted hint.
 * - `wrong-name`: its own name is a different place's (`placeNameVerdict`
 *   says `mismatch`). A name the check cannot compare, such as an answer in
 *   Japanese script for a romanised query, is not a mismatch and does not
 *   refuse anything.
 */
export type MatchVerdict = "agrees" | "unchecked" | "wrong-place" | "wrong-name";

/** True for the two verdicts a caller may store. */
export function accepted(verdict: MatchVerdict): verdict is "agrees" | "unchecked" {
  return verdict === "agrees" || verdict === "unchecked";
}

/**
 * Judge a candidate against every belief we hold, not just the strongest one
 * (KI-15's second bug: a wrong hint near the top result was reported verified
 * with a trip region right there, unconsulted).
 */
export function judgeMatch(
  query: NameQuery,
  match: Pick<GeocodeResult, "lat" | "lng" | "canonicalName">,
  belief: PlaceBelief,
): MatchVerdict {
  const point: LatLng = { lat: match.lat, lng: match.lng };
  const { region } = belief;
  if (hintTrusted(belief)) {
    // A trusted hint already sits inside the region, so a match near it almost
    // always does too. Checked anyway for a hint near the region's own edge.
    if (distanceKm(belief.hint, point) > MAX_REFINE_KM) return "wrong-place";
    if (region != null && !withinBox(region, point)) return "wrong-place";
  } else if (region != null && !withinBox(region, point)) {
    return "wrong-place";
  }
  if (placeNameVerdict(query.place, match.canonicalName, query.context) === "mismatch") return "wrong-name";
  return hintTrusted(belief) || region != null ? "agrees" : "unchecked";
}
