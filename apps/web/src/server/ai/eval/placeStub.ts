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
// - **Names shaped like real places.** A stub that answered "garden" with
//   "Garden Park House" got a refusal to swap in a place it "couldn't confirm
//   is a real garden" (d-closed-find-similar, 2026-10-24). So a common kind of
//   place gets names like Tokyo's own, invented so the model cannot know them
//   as somewhere else, and any other kind gets a word before it, never a suffix.
import type { PlaceLookup, ResolvedPlace } from "@/server/assistant/deps";
import { PLACE_CANDIDATES_PER_QUERY } from "@/server/assistant/tools/places";
import type { BoundingBox } from "@/server/geocoding/geocoder";

// Letters, not `\b`: a non-unicode `\b` sees no word end after "café".
const word = (words: string) => new RegExp(`(?<!\\p{L})(${words})(?!\\p{L})`, "iu");
const COFFEE = word("coffee|caf[eé]|espresso|latte|cappuccino");
const CAFES = ["Little Owl Coffee", "Corner Roast Café", "Morning Lane Espresso"];

// First match wins, so a "sushi bar" is sushi and a "beer garden" a bar.
const KINDS: readonly { match: RegExp; names: string[] }[] = [
  { match: word("ramen|noodles?"), names: ["Menya Kogetsu Ramen", "Hinode Ramen", "Torao Ramen"] },
  { match: word("sushi"), names: ["Tomoe Sushi", "Uogashi Sushi", "Sushiya Shiogama"] },
  { match: word("izakaya|bars?|pubs?|sake|beer|cocktails?|drinks?"), names: ["Torikichi Izakaya", "Hoshizora Bar", "Sakaba Akari"] },
  { match: word("tea|matcha"), names: ["Chaya Ippuku", "Midori Matcha Stand", "Kotoha Tea Salon"] },
  { match: word("baker(?:y|ies)|bread|boulangerie|pastr(?:y|ies)"), names: ["Komugi Bakery", "Boulangerie Asahi", "Pan no Mori"] },
  { match: word("markets?"), names: ["Yanagi Shotengai Market", "Hinode Morning Market", "Kotobuki Food Hall"] },
  { match: word("gardens?"), names: ["Kotobuki Teien Garden", "Shiraume Garden", "Mizunami Stroll Garden"] },
  { match: word("parks?"), names: ["Momiji Park", "Hanamizuki Park", "Aoba Riverside Park"] },
  { match: word("shrines?"), names: ["Asahi Hachiman Shrine", "Tsukimi Shrine", "Shirasagi Inari Shrine"] },
  { match: word("temples?"), names: ["Jokoji Temple", "Ryusen-in Temple", "Horinji Temple"] },
  { match: word("museums?|galler(?:y|ies)"), names: ["Kanda Print Museum", "Shirokane Craft Museum", "Tsukiji Lantern Museum"] },
];
// Any other kind gets one of these before it ("Hinode Onsen"), as a shop's own
// name goes before what it sells.
const NAME_WORDS = ["Hinode", "Sakura", "Kotobuki"];

// Where a search with no region is centred: the seeded Japan trip's Tokyo.
const NO_REGION = { lat: 35.68, lng: 139.76 };

/**
 * The names one query gets. A query with a capital past its first word is a
 * place someone named ("Fushimi Inari Shrine"), and a real search finds it
 * first. Anything else is a kind of place, however it is cased ("Tea house"),
 * which a real search answers with places of that kind, never one called "ramen"
 * or "Ramen House".
 */
function namesFor(query: string): string[] {
  // Without the city the near-now search appends, and the "near X" a model
  // types, neither of which a place is named after.
  const what = query.split(",")[0]!.replace(/\s+near\s.*$/i, "").trim() || query;
  if (COFFEE.test(what)) return CAFES;
  if (/\s\p{Lu}/u.test(what)) return [what, `${what} North Gate`, `${what} South Gate`];
  const kind = KINDS.find(({ match }) => match.test(what));
  if (kind) return kind.names;
  const title = what.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return NAME_WORDS.map((name) => `${name} ${title}`);
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
