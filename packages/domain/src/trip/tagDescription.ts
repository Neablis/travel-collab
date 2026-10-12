import { ActivityTagDescribed, type ActivityKind, type ActivityTag } from "@tc/contracts";

// What kind of trip or day this is, from its stops' tags (ADR-070 decision 3,
// M42 D8). Computed wherever it is shown and never stored: the tags are the
// fact, and a stored sentence would be a second copy that a retag leaves stale.
//
// Lodging is a category, but every trip sleeps somewhere, so it never names
// one. Ticketed is a modifier (decision 2) and counts for nothing here. A
// transit stop is travel between the things a trip is about, so it is not
// counted either, whatever it is tagged.

/** A category a description can name: every category but Lodging (the contract's `ActivityTagDescribed`). */
export type DescribedTag = ActivityTagDescribed;

/** The two fields the rule reads, so a trip's `ActivityView` and a saved day's `SavedStop` both fit. */
export type DescribableStop = { readonly kind: ActivityKind; readonly tags: readonly ActivityTag[] };

/** The words, and the categories that earned them: none, one or two, the larger share first. */
export type TagDescription = { readonly text: string; readonly named: readonly DescribedTag[] };

// Four, because below it one stop is more than a third of what is counted:
// a three-stop day with a bar on it would be "Drinks-led" on the strength of
// one stop, and Food's half would need only two meals. A bundled day has six to
// eight stops, so four leaves out short days and sparsely tagged trips, which
// is the point: no description is better than a misleading one.
/** Fewer counted stops than this, and there is no description. */
export const MIN_DESCRIBED_STOPS = 4;

/** The answer when enough stops are tagged and no category stands out. */
export const A_BIT_OF_EVERYTHING = "A bit of everything";

// Food has the higher bar because every trip eats; any other category is
// measured against the stops that are something other than a meal, and must be
// on two of them (ADR-070 §3, amended): after four meals, one bar is 100% of
// the non-Food stops and still not what the day is about.
const FOOD_SHARE = 0.5;
const OTHER_SHARE = 0.25;
const OTHER_MIN_STOPS = 2;

// Sentence case: one category is its adjective alone ("Outdoorsy"), two are a
// pair of nouns, the first capitalised ("Beach & outdoors").
/** The words for each category a description can name. */
export const TAG_DESCRIPTION_COPY: Record<DescribedTag, { adjective: string; noun: string }> = {
  meal: { adjective: "Foodie", noun: "food" },
  outdoors: { adjective: "Outdoorsy", noun: "outdoors" },
  drinks: { adjective: "Drinks-led", noun: "drinks" },
  nightlife: { adjective: "Late-night", noun: "nightlife" },
  museum: { adjective: "Museum-going", noun: "museums" },
  sight: { adjective: "Sightseeing", noun: "sights" },
  beach: { adjective: "Beachy", noun: "beach" },
  shopping: { adjective: "Shopping", noun: "shopping" },
  show: { adjective: "Show-going", noun: "shows" },
  tour: { adjective: "Guided", noun: "tours" },
  wellness: { adjective: "Restful", noun: "wellness" },
};

// Contract order, which is also the tie-break everywhere below: two shares that
// are equal must always come out the same way round.
const DESCRIBED: readonly DescribedTag[] = ActivityTagDescribed.options;

/** How many counted stops carry each described tag, and how many are counted at all. */
function tally(stops: readonly DescribableStop[]) {
  const counts = new Map<DescribedTag, number>();
  let counted = 0;
  let nonFood = 0;
  for (const stop of stops) {
    if (stop.kind === "transit") continue;
    const tags = DESCRIBED.filter((tag) => stop.tags.includes(tag));
    if (tags.length === 0) continue;
    counted += 1;
    if (tags.some((tag) => tag !== "meal")) nonFood += 1;
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return { counts, counted, nonFood };
}

/**
 * What kind of trip or day `stops` make, by ADR-070's rule: "Outdoorsy",
 * "Beach & outdoors", "A bit of everything" — or null when fewer than
 * `MIN_DESCRIBED_STOPS` stops carry a category, Lodging aside.
 */
export function describeByTags(stops: readonly DescribableStop[]): TagDescription | null {
  const { counts, counted, nonFood } = tally(stops);
  if (counted < MIN_DESCRIBED_STOPS) return null;
  const share = (tag: DescribedTag) => (counts.get(tag) ?? 0) / (tag === "meal" ? counted : nonFood);
  const qualifies = (tag: DescribedTag) =>
    tag === "meal"
      ? share(tag) >= FOOD_SHARE
      : share(tag) >= OTHER_SHARE && (counts.get(tag) ?? 0) >= OTHER_MIN_STOPS;
  const named = DESCRIBED.filter(qualifies)
    // Stable, so equal shares keep contract order.
    .sort((a, b) => share(b) - share(a))
    .slice(0, 2);
  const [first, second] = named;
  if (first === undefined) return { text: A_BIT_OF_EVERYTHING, named };
  if (second === undefined) return { text: TAG_DESCRIPTION_COPY[first].adjective, named };
  const noun = TAG_DESCRIPTION_COPY[first].noun;
  return { text: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} & ${TAG_DESCRIPTION_COPY[second].noun}`, named };
}

/**
 * Every category the description counted on these stops, the most stops first
 * and ties in contract order: the tags a day page and a Discover card show
 * beside the description. Lodging, Ticketed and transit stops are left out, as
 * the description leaves them out.
 */
export function describedTags(stops: readonly DescribableStop[]): DescribedTag[] {
  const { counts } = tally(stops);
  return DESCRIBED.filter((tag) => counts.has(tag)).sort((a, b) => counts.get(b)! - counts.get(a)!);
}
