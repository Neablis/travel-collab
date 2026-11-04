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
import { nameTokens, placeNameVerdict, type NameVerdict } from "./geocodeNameMatch";

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
 * What a candidate's name is compared with: the stop's name, split at its
 * commas, and the geography the stop carries in its own fields.
 *
 * A stop's name often holds more than its venue: "Kegon Falls, Chūzenji,
 * Nikkō" carries its geography, "Dinner, Ria's Wines" an activity, and "Rome,
 * Trevi Fountain" puts the city first. Which segment names the venue is not
 * knowable from the string, so `nameVerdictOf` tries each one, with the others
 * as context.
 */
export interface NameQuery {
  segments: string[];
  context: string[];
}

/** A location's `NameQuery`: its name's comma segments, and the city, area and postal geography it carries. */
export function nameQueryOf(location: Pick<Location, "name" | "city" | "area" | "address">): NameQuery {
  const segments = location.name
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const context = [
    location.area,
    location.city,
    location.address?.dependentLocality,
    location.address?.locality,
    location.address?.administrativeArea,
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  return { segments, context };
}

/**
 * A segment that starts like a street address: a house number ("123",
 * "221B", "1-2-3") and then a word. Such a segment names no venue, and the
 * vendor's label for an address leads with the number alone, so comparing them
 * refused every address sent as a name (review of PR 686, finding 3). A bare
 * number is still a name: a bar called "1905".
 */
const STREET_ADDRESS = /^\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)*\s+\p{L}/u;

/**
 * Whether a candidate's own name is the place the stop names: `match`,
 * `mismatch`, or `not-comparable` (the check cannot tell, and refuses nothing).
 *
 * Each comma segment of the stop's name is tried as the venue, with the other
 * segments and the stop's own geography as context (`placeNameVerdict`, KI-39).
 * The first `match` wins. Two kinds of segment are not tried:
 *
 * - **the candidate's own geography**: a segment every word of which appears
 *   in the candidate's label after its own name. "Rome" in "Rome, Trevi
 *   Fountain" is where the answer is, not what it is called, and trying it
 *   would accept any place in Rome. A stop named only for its town ("Penn Yan")
 *   against a shop in that town therefore compares nothing and is a mismatch.
 * - **a street address**, which makes the verdict `not-comparable`: the
 *   geometry decides alone, as it did before the name check existed.
 *
 * A segment `placeNameVerdict` cannot compare (an answer in Japanese script)
 * also makes the verdict `not-comparable` when nothing matched.
 *
 * The one rule for every path that checks a geocoded name: the assistant's
 * enrichment and the v1 stop writes through `judgeMatch`, and the Playbook map
 * backfill (`savedDayPins.ts`) directly.
 */
export function nameVerdictOf(query: NameQuery, candidateDisplayName: string): NameVerdict {
  const geography = new Set(nameTokens(candidateDisplayName.split(",").slice(1).join(" ")));
  let uncomparable = false;
  for (const [index, segment] of query.segments.entries()) {
    if (STREET_ADDRESS.test(segment)) {
      uncomparable = true;
      continue;
    }
    const tokens = nameTokens(segment);
    if (tokens.length > 0 && tokens.every((token) => geography.has(token))) continue;
    const others = query.segments.filter((_, other) => other !== index);
    const verdict = placeNameVerdict(segment, candidateDisplayName, [...others, ...query.context]);
    if (verdict === "match") return "match";
    if (verdict === "not-comparable") uncomparable = true;
  }
  return uncomparable ? "not-comparable" : "mismatch";
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
  if (nameVerdictOf(query, match.canonicalName) === "mismatch") return "wrong-name";
  return hintTrusted(belief) || region != null ? "agrees" : "unchecked";
}
