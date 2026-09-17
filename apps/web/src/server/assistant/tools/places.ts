// The place family — one tool, and the milestone's title in a file.
//
// > **The model becomes structurally incapable of naming a place it did not
// > search for.**
//
// That is M9's scope talking, and it is the same guarantee `idFields.ts`
// already gives for UUIDs: an id the model never read has no spelling that
// resolves, so it cannot be written. `search_places` numbers what a vendor
// returned; `AddActivity`/`UpdateActivity` cite `placeRef: N`; the SERVER
// resolves N into the place's name and coordinates before a human ever sees
// the proposal. A place with no number has no citation.
//
// **Why a tool rather than better post-processing.** Geocoding was bolted on
// after the model decided (KI-15), which can only ever confirm or corrupt a
// decision already made — on the 2026-08-02 Rochester run it corrupted a
// correct answer and silently dropped seven others. The model was being asked
// to FIND places while unable to LOOK ANYTHING UP, so "find restaurants near
// the falls" was answered from parametric memory and was unverifiable by
// construction. Enrichment is not deleted by this: it is demoted to what it is
// good at, which is a location a PERSON typed.
//
// **It is the first tool that declares `spend: "vendor"`.** That tag has been
// recorded and read by nothing since P5, whose own note explains why: the real
// LocationIQ door was `commitProposal`'s geocoder on the apply path, which is
// not a tool and does not run inside a turn at all. There are now two doors,
// both declared, and both charge the geocode quota (KI-93).
//
// **The step cost is the thing to watch**, and the milestone says so: search
// then act is 2-3 steps, not one step per place. That is why the input is an
// ARRAY of queries and why the description says so twice — a model that calls
// this once per restaurant turns a 2-step turn into an 18-step one, which is
// the cost driver `meta.steps` exists to measure.
import { z } from "zod";
import { defineTool } from "@/server/assistant/defineTool";
import { untrusted } from "@/server/assistant/prompt";
import { tripRegionOf } from "@/server/ai/geocodeRegion";
import type { PlaceCandidate, PlaceLookup } from "@/server/assistant/deps";

/**
 * How many queries one call may carry.
 *
 * The vendor's free tier is 2 requests/second and the port throttles to it, so
 * eight queries is ~4 seconds of wall clock inside a turn that already takes
 * several. Past that the turn starts to feel hung, and a model that wants more
 * than eight places at once is usually planning a whole trip in one step —
 * which is a second call, not a bigger one.
 */
export const MAX_PLACE_QUERIES = 8;

/**
 * How many candidates one query prints.
 *
 * Three, not ten: the model picks by name, and a longer list is more tokens for
 * a choice it makes on the first line. `/v1/search` is asked for the same
 * number, so the trimming happens at the vendor rather than after paying for it.
 */
export const PLACE_CANDIDATES_PER_QUERY = 3;

const SearchPlacesInput = z.object({
  queries: z
    .array(z.string().min(1).max(200))
    .min(1)
    .max(MAX_PLACE_QUERIES)
    .describe(
      `The places to look up, as you would type them into a maps search — "Niagara Falls State Park", "ramen near Shinjuku Station". Put EVERY place this turn needs in ONE call (up to ${MAX_PLACE_QUERIES}); calling this once per place is the single most expensive mistake you can make in a turn.`,
    ),
});

/** One candidate as the model reads it. `ref` is what a write tool cites. */
const PlaceCandidateSchema = z.object({
  ref: z.number().int().positive(),
  name: z.string(),
  city: z.string().optional(),
  area: z.string().optional(),
  countryCode: z.string().optional(),
});

const PlaceQueryReadout = z.object({
  query: z.string(),
  candidates: z.array(PlaceCandidateSchema),
  /**
   * Why there are no candidates, when there are none for a reason other than
   * "the vendor knows no such place". Present only then, so its absence beside
   * an empty list means exactly "nothing matched".
   */
  note: z.string().optional(),
});

const PlaceSearchReadout = z.object({
  results: z.array(PlaceQueryReadout),
});

export type PlaceSearchReadout = z.infer<typeof PlaceSearchReadout>;

/**
 * **No coordinates in the readout, and that is the design rather than brevity.**
 *
 * The model's job is to CHOOSE a candidate, not to hold one. Printing lat/lng
 * would hand back the exact value grounding exists to stop it writing — and a
 * model that has seen a coordinate can type it into `location` directly,
 * bypassing the citation entirely. It picks by name and cites by number; the
 * server holds the numbers.
 */
function readoutFor(lookups: readonly PlaceLookup[], numbered: readonly (readonly PlaceCandidate[])[]) {
  return {
    results: lookups.map((lookup, index) => {
      const candidates = (numbered[index] ?? []).map((candidate) => ({
        ref: candidate.ref,
        name: candidate.name,
        ...(candidate.city === undefined ? {} : { city: candidate.city }),
        ...(candidate.area === undefined ? {} : { area: candidate.area }),
        ...(candidate.countryCode === undefined ? {} : { countryCode: candidate.countryCode }),
      }));
      return {
        query: lookup.query,
        candidates,
        ...(lookup.skipped === undefined ? {} : { note: NOTE_FOR[lookup.skipped] }),
      };
    }),
  };
}

/**
 * What the model is told when a lookup did not happen.
 *
 * Both say the same operational thing — do not retry this, it will not work
 * this turn — because both are true, and a model told "try again" against a
 * daily ceiling spends the rest of the turn's steps proving it.
 */
const NOTE_FOR: Record<NonNullable<PlaceLookup["skipped"]>, string> = {
  quota: "Not looked up: this trip has reached its place-search limit for today. Do not search again this turn; add the stop without a placeRef and say in your reply that its exact spot is not confirmed.",
  unavailable: "Not looked up: the place service did not answer. Do not search again this turn; add the stop without a placeRef and say in your reply that its exact spot is not confirmed.",
};

/**
 * The tool.
 *
 * `needs` is the whole of its reach and reads as the sentence it is: the TRIP
 * (to bias the search toward where the trip already is), the PORT (to look up,
 * and to charge), and the CACHE (to number what came back). It takes no
 * `tripId` and no `userId`, by the same structural rule the other read tools
 * follow — the actor arrives from the guard's answer, never from anything a
 * model can type (ADR-022 §3), and the port reads it off `actor`.
 */
export const searchPlacesTool = defineTool({
  name: "search_places",
  description: `Look up real places — restaurants, museums, parks, stations, hotels — and get back numbered candidates. You MUST call this before adding or updating a stop that names a real place, and then cite the candidate you chose as \`placeRef\` on that stop instead of writing a location yourself. A stop you add without a placeRef is one nobody has checked exists. Put every place the turn needs into ONE call's \`queries\` array (up to ${MAX_PLACE_QUERIES}) — not one call per place.`,
  domain: "places",
  effect: "read",
  // The first one. See the file header.
  spend: "vendor",
  input: SearchPlacesInput,
  output: PlaceSearchReadout,
  needs: ["trip", "actor", "placeSearch", "placeCache"] as const,
  // A viewer may search: it reads a public gazetteer and writes nothing. What
  // a viewer cannot do is cite the result, because they hold no write tool —
  // which is the grant arithmetic doing its job rather than a second rule here.
  minimumRole: "viewer",
  // **Every candidate name is somebody else's text.** OpenStreetMap is
  // user-contributed, so a venue name is exactly the author-written string the
  // fence exists for — the same class as a Playbook day's name, and the case
  // `insert_playbook_day` shipped wrong. `query` is the model's own argument
  // echoed back and `note` is ours, so neither is fenced.
  taint: (readout: PlaceSearchReadout) => ({
    ...readout,
    results: readout.results.map((result) => ({
      ...result,
      candidates: result.candidates.map((candidate) => ({
        ...candidate,
        name: untrusted(candidate.name),
        ...(candidate.city === undefined ? {} : { city: untrusted(candidate.city) }),
        ...(candidate.area === undefined ? {} : { area: untrusted(candidate.area) }),
      })),
    })),
  }),
  run: async (input, deps) => {
    const lookups = await deps.placeSearch.search({
      queries: input.queries,
      // Soft bias toward where the trip already is, and null on a trip with no
      // coordinates yet — which is honest rather than a default. `tripRegionOf`
      // is reused, never restated: it is the same box `enrichCommandLocations`
      // checks a result against, so the search is biased toward the region the
      // acceptance test will apply (KI-15).
      region: tripRegionOf(deps.trip),
      userId: deps.actor.userId,
    });
    // Numbered in lookup order, so the printed list and the cache agree. The
    // cache is appended to rather than replaced: a second call in the same turn
    // continues the numbering, and a ref the model read in step 2 still means
    // the same place in step 5.
    const numbered = lookups.map((lookup) => deps.placeCache.add(lookup.places));
    return readoutFor(lookups, numbered);
  },
});

export const PLACE_TOOLS = [searchPlacesTool] as const;
