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

// The same category nouns as above, spelled the way Japanese place names spell
// them: a romanised suffix rather than a separate English word. "Tenryū-ji" and
// "Tenryū Temple" are one name in two languages, and LocationIQ answers with
// whichever one OSM happens to hold — so without this map the verdict for a
// correct venue depends on the vendor's choice of language, which is the defect
// KI-77 records.
//
// This is NOT a widening of GENERIC_TOKENS and must not become one. Every entry
// folds onto a category noun ALREADY in the set above, so the set of things
// treated as a category is unchanged; only their spellings grow. A genuinely
// new generic word would shrink the distinctive set, which the comment above
// warns against.
//
// Deliberately excluded, with reasons, because each would cost a rejection the
// module is required to keep making:
//   - "ya" (屋, shop/house). Would reduce "Yoshida-ya" to ["yoshida"] and so
//     accept "Steak House Yoshida" and "Coffee Yoshida" — two of KI-39's own
//     wrong-venue rows.
//   - "gu" (宮, shrine) and "in" (院, sub-temple). Two letters, no seed stop
//     needs them, and a two-letter token is the most likely to collide with a
//     real name fragment.
const CATEGORY_SYNONYMS = new Map<string, string>([
  ["ji", "temple"],
  ["dera", "temple"],
  ["tera", "temple"],
  ["jingu", "shrine"],
  ["jinja", "shrine"],
  ["taisha", "shrine"],
]);

function isCategoryToken(token: string): boolean {
  const canonical = CATEGORY_SYNONYMS.get(token);
  return GENERIC_TOKENS.has(token) || (canonical !== undefined && GENERIC_TOKENS.has(canonical));
}

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
  const distinctive = all.filter((t) => !isCategoryToken(t) && !contextTokens.has(t));
  return distinctive.length > 0 ? distinctive : all;
}

// A LocationIQ `display_name` is "<the object's own name>, <address…>". Only
// the first segment names the thing; the rest is street/ward/prefecture and
// would match on geography we deliberately excluded above.
export function candidateOwnName(displayName: string): string {
  return displayName.split(",")[0]?.trim() ?? "";
}

// Every concatenation of a CONTIGUOUS RUN of tokens, e.g.
// ["nishi", "azabu"] -> {"nishi", "azabu", "nishiazabu"}. This is what makes
// the comparison insensitive to where a name puts its separators, without
// making it a substring test: a run always starts and ends on a token
// boundary, so "shin" still does not match "Shinagawa" and "kichi" still does
// not match "KICHIRI" (KI-77). Names here are a handful of tokens, so the
// quadratic run set is a few dozen strings.
function tokenRuns(tokens: readonly string[]): Set<string> {
  const runs = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    let run = "";
    for (let end = start; end < tokens.length; end += 1) {
      run += tokens[end];
      runs.add(run);
    }
  }
  return runs;
}

// Can the required tokens be covered by the candidate's runs, allowing
// ADJACENT required tokens to be joined the same way? Reduces exactly to the
// old "every required token is a candidate token" when no joining is needed;
// the joining is what lets "Ginkaku"+"ji" meet a candidate spelled
// "Ginkakuji". Segment boundaries are token boundaries on both sides, so this
// stays an equality test, not a containment one.
function runsCover(required: readonly string[], candidateRuns: ReadonlySet<string>): boolean {
  const reached = new Array<boolean>(required.length + 1).fill(false);
  reached[0] = true;
  for (let from = 0; from < required.length; from += 1) {
    if (!reached[from]) continue;
    let segment = "";
    for (let to = from; to < required.length; to += 1) {
      segment += required[to];
      if (candidateRuns.has(segment)) reached[to + 1] = true;
    }
  }
  return reached[required.length] === true;
}

// Every distinctive token of the queried place must appear as a token of the
// candidate's own name. ALL, not ANY: "Bread & Espresso" vs. "Cawaii Bread &
// Coffee" and "Yoshida-ya" vs. "Coffee Yoshida" both share one token and are
// both the wrong venue. Token equality, not substring: "Kichi Kichi" must not
// match "KICHIRI".
//
// Two accept paths, because KI-77 showed one is not enough:
//
//  1. WHOLE-NAME IDENTITY on the separator-insensitive fold — the two names
//     are the same string once punctuation is removed ("Ginkaku-ji" vs.
//     "Ginkakuji"). This is identity, not containment, so it cannot accept a
//     different venue; and it is checked on the RAW token list, before
//     category nouns are dropped, which is what makes it survive the trap
//     below.
//  2. TOKEN COVER, generalised over runs (above) so that a separator the
//     vendor puts somewhere else is not an identity difference
//     ("Gonpachi Nishiazabu" vs. "Gonpachi Nishi-Azabu").
//
// The trap, decided deliberately: because CATEGORY_SYNONYMS makes "ji" a
// category noun, path 2 requires only ["tenryu"] of "Tenryū-ji", so a
// hypothetical "Tenryu Restaurant" in the same ward would read as a match.
// That is ACCEPTED, on the grounds that it is not a new risk: "Tenryū Temple"
// — the same name in English, and the spelling the vendor actually returned —
// already behaves exactly that way, since "temple" has been generic since
// KI-39. The alternative (keep "ji" distinctive) makes the verdict for a
// correct venue depend on which language the vendor answered in, which is the
// defect KI-77 exists to remove. Path 1 is what pays for the loss: it accepts
// the identical name outright without consulting the category set at all.
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
  const placeAll = nameTokens(place);
  if (placeAll.length === 0) return "not-comparable";

  if (placeAll.join("") === candidate.join("")) return "match";

  const required = distinctiveTokens(place, context);
  return runsCover(required, tokenRuns(candidate)) ? "match" : "mismatch";
}
