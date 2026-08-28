// Name identity for a geocode candidate (KI-39) — the acceptance test
// `withinBox` (geocodeRegion.ts) structurally cannot make.
//
// A per-city bounding box only rejects a wrong-CITY match. It has no way to
// reject a wrong-VENUE match that lands inside the right city: "Kegon Falls,
// Chūzenji, Nikkō" resolving to Urami Falls (a different waterfall, same
// city), "Zentis Osaka, Kita, Osaka" to Hotels Inn Osaka KitaUmeda (a
// different hotel, same city), "Shin-Osaka Station, Yodogawa, Tokyo" to
// Shinagawa Station. All three passed the box and were caught by hand.
//
// Pure string work, no I/O and no vendor knowledge — same contract as
// geocodeRegion.ts, which holds the geometric half of the same question.
// Kept in its own module rather than added to that one because "is this
// point where I asked" and "is this the place I asked for" are different
// kinds of evidence, and geocodeRegion.ts's own header promises arithmetic.

// The verdict is deliberately three-valued rather than boolean. "Not
// comparable" is a real and common outcome for Japan and is NOT a mismatch:
// LocationIQ answers a romanised query with the object's local-script name
// whenever OSM has no `name:en` for it ("Meiji Jingū" -> 明治神宮, "Tsukiji
// Outer Market" -> 築地場外市場, "teamLab Planets" -> チームラボ プラネッツ —
// 24 of the Japan seed's 54 original resolutions look like this, and every
// one of them is the right place). Collapsing that into "mismatch" would
// throw away two dozen correct pins; collapsing it into "match" would hide
// from the caller that nothing was actually verified. The caller decides —
// and, for the seed script, reports which pins rest on the box alone.
export type NameVerdict = "match" | "mismatch" | "not-comparable";

// Category nouns carry no identity: every waterfall is a "Falls", every
// station a "Station". They are exactly the tokens the three known
// wrong-venue matches shared with the query, so they are excluded from the
// distinctive set. Kept deliberately short — a long list shrinks the
// distinctive set toward nothing and weakens the check.
const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "of",
  "at",
  "airport",
  "art",
  "bar",
  "cafe",
  "castle",
  "center",
  "centre",
  "coffee",
  "falls",
  "garden",
  "gardens",
  "hotel",
  "hotels",
  "house",
  "inn",
  "market",
  "museum",
  "park",
  "restaurant",
  "ryokan",
  "shrine",
  "station",
  "sushi",
  "temple",
  "terminal",
]);

// Fold to comparable tokens: NFKD + strip combining marks (so "Gōra Kadan"
// and "Gora Kadan" agree, and full-width Latin folds to ASCII), lowercase,
// then split on everything that is not a latin letter or digit. CJK, kana and
// punctuation all fall out here — which is what makes an all-local-script
// name produce zero tokens and land in "not comparable" below.
export function nameTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// The tokens that actually identify the place: its own name minus category
// nouns and minus the geography already in the query (area, city, country) —
// "Osaka" cannot distinguish Zentis Osaka from any other hotel in Osaka.
// If that leaves nothing (a place named entirely from generic and
// geographic words), fall back to the full token list rather than accepting
// vacuously: an empty requirement matches everything.
export function distinctiveTokens(place: string, context: readonly string[] = []): string[] {
  const all = nameTokens(place);
  const contextTokens = new Set(context.flatMap((c) => nameTokens(c)));
  const distinctive = all.filter((t) => !GENERIC_TOKENS.has(t) && !contextTokens.has(t));
  return distinctive.length > 0 ? distinctive : all;
}

// A LocationIQ `display_name` is "<the object's own name>, <address…>". Only
// the first segment names the thing; the rest is street/ward/prefecture and
// would match on geography we deliberately excluded above.
export function candidateOwnName(displayName: string): string {
  return displayName.split(",")[0]?.trim() ?? "";
}

// Every distinctive token of the queried place must appear as a token of the
// candidate's own name. ALL, not ANY: "Bread & Espresso" vs. "Cawaii Bread &
// Coffee" and "Yoshida-ya" vs. "Coffee Yoshida" both share one token and are
// both the wrong venue. Token equality, not substring: "Kichi Kichi" must not
// match "KICHIRI".
//
// This is an identity check, not a spelling check — it cannot tell two
// branches of the same chain apart ("Onibus Coffee, Nakameguro" vs. the
// Setagaya one), which stays the box's job and the human's.
export function placeNameVerdict(
  place: string,
  candidateDisplayName: string,
  context: readonly string[] = [],
): NameVerdict {
  const candidate = nameTokens(candidateOwnName(candidateDisplayName));
  if (candidate.length === 0) return "not-comparable";
  const required = distinctiveTokens(place, context);
  if (required.length === 0) return "not-comparable";
  const candidateSet = new Set(candidate);
  return required.every((token) => candidateSet.has(token)) ? "match" : "mismatch";
}
