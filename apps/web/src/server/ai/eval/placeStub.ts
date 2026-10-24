// **The eval's place search: a stub, so a run needs no LocationIQ key and
// spends no lookups.** It must answer the way production does, or the model
// grades the stub instead of itself:
//
// - **No geography to contradict the question.** The first full run's stub put
//   every place in Kyoto, and the model correctly refused to cite a "Kyoto"
//   lunch for Shibuya. So a name carries no city, and every place sits inside
//   the region the search was biased to.
// - **Real-looking names, as many as production prints.** The next stub
//   answered "coffee" with one place called "coffee", which reads as nothing
//   found, and the model searched again: d-coffee-near-now failed its one-call
//   check 3/3 on 2026-10-24. Production prints up to
//   `PLACE_CANDIDATES_PER_QUERY` named places, so the stub does too.
import type { PlaceLookup, ResolvedPlace } from "@/server/assistant/deps";
import { PLACE_CANDIDATES_PER_QUERY } from "@/server/assistant/tools/places";
import type { BoundingBox } from "@/server/geocoding/geocoder";

// Letters, not `\b`: a non-unicode `\b` sees no word end after "café".
const COFFEE = /(?<!\p{L})(coffee|caf[eé]|espresso|latte|cappuccino)(?!\p{L})/iu;
const CAFES = ["Little Owl Coffee", "Corner Roast Café", "Morning Lane Espresso"];

// Where a search with no region is centred: the seeded Japan trip's Tokyo.
const NO_REGION = { lat: 35.68, lng: 139.76 };

/**
 * The names one query gets. A query with a capital past its first word is a
 * place someone named ("Fushimi Inari Shrine"), and a real search finds it
 * first. Anything else is a kind of place, however it is cased ("Tea house"),
 * which a real search answers with places of that kind, never one called "ramen".
 */
function namesFor(query: string): string[] {
  // Without the city the near-now search appends, and the "near X" a model
  // types, neither of which a place is named after.
  const what = query.split(",")[0]!.replace(/\s+near\s.*$/i, "").trim() || query;
  if (COFFEE.test(what)) return CAFES;
  if (/\s\p{Lu}/u.test(what)) return [what, `${what} North Gate`, `${what} South Gate`];
  const title = what.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return [`${title} House`, `The ${title} Room`, `${title} on the Corner`];
}

/** One query's places, a little apart around the region's centre and inside it. */
function placesFor(query: string, region: BoundingBox | null): ResolvedPlace[] {
  const centre = region ? { lat: (region.minLat + region.maxLat) / 2, lng: (region.minLng + region.maxLng) / 2 } : NO_REGION;
  // A tenth of the box's half-span per step, so three steps stay inside it.
  const step = region
    ? { lat: (region.maxLat - region.minLat) / 20, lng: (region.maxLng - region.minLng) / 20 }
    : { lat: 0.002, lng: 0.002 };
  return namesFor(query)
    .slice(0, PLACE_CANDIDATES_PER_QUERY)
    .map((name, index) => ({ name, lat: centre.lat + step.lat * index, lng: centre.lng - step.lng * index }));
}

/** What the stub answers for each query: `PlaceSearchPort.search`, deterministically. */
export function stubPlaceSearch({ queries, region }: { queries: readonly string[]; region: BoundingBox | null }): PlaceLookup[] {
  return queries.map((query) => ({ query, places: placesFor(query, region) }));
}
