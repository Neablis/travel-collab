// The app's side of the kernel's library ports (ADR-043 decision 1, P2).
//
// **This file exists because the import wall could not be true without it.**
// The wall ADR-043 first specified named five forbidden modules, and lint
// agreed the kernel was clean while `search_playbooks` reached Postgres through
// `@/server/playbooks` and `insert_playbook_day` through `@/server/savedDays` —
// both of which import `./db/client` one hop down, which ESLint does not
// follow. The wall is now deny-by-default over `@/server/**` with an
// allowlist, so those two imports are refused at the kernel's edge, and these
// two adapters are where they land instead. M9's grounding added a third, for
// the same reason and one hop shorter: `getGeocoder()` reads `serverConfig`
// directly.
//
// Each is deliberately thin. An adapter that computed anything would be tool
// logic outside the kernel — the audit property (`needs` names everything a
// tool may touch) survives only while the port is the whole of the reach and
// nothing decides anything on the way through.
//
// **`placeSearchPort` is the one that tests that rule, and it passes.** It
// charges a quota, paces a vendor and normalises a result, none of which is a
// DECISION about what the tool does: the quota is a fact about the key, the
// pace is a fact about the vendor, and the normalisation is the port's own
// vocabulary. What it does not do is choose a place, rank one, or decide what a
// refusal means to the turn — all three are the tool's, and all three are in
// `tools/places.ts`.
import { discoverDays } from "@/server/playbooks";
import { readableSavedDay } from "@/server/savedDays";
import { getGeocoder } from "@/server/geocoding";
import { consumeQuota, geocodeQuota } from "@/server/quota";
import { MIN_INTERVAL_MS } from "@/server/ai/rateLimit";
import { PLACE_CANDIDATES_PER_QUERY } from "@/server/assistant/tools/places";
import type {
  PlaceLookup,
  PlaceSearchPort,
  PlaybookLibrary,
  ResolvedPlace,
  SavedDayLibrary,
} from "@/server/assistant/deps";
import type { GeocodeResult, Geocoder } from "@/server/geocoding";

/**
 * `search_playbooks`'s corpus.
 *
 * **`scope: "everyone"`, not a third copy of the visibility clause.**
 * `scopePredicate` (playbooks.ts) spells `everyone` as *"published, or mine"* —
 * which is exactly `readableSavedDay`'s WHERE clause, the one the apply door
 * re-runs per day. A separate query would agree with it only until somebody
 * edited one of them, and the two directions that disagreement can go are both
 * bad: narrower proposes days that 404 on approval, wider enumerates what
 * people have kept private.
 *
 * Most-added first: the ledger is the library's own answer to "which of these
 * is worth taking", and it is the ranking Discover offers a person making the
 * same choice.
 *
 * It costs one extra `count(*)` (`publishedDayCount`) that this caller does not
 * read. That is the price of the shared query, and it is one indexed count over
 * a small table — cheap next to a second predicate to keep in step.
 */
export const playbookLibrary: PlaybookLibrary = {
  discover: async ({ cities, readerId }) =>
    (await discoverDays({ cities, scope: "everyone", sort: "most-added", budget: "any", length: "any", season: null, readerId }))
      .days,
};

/**
 * `insert_playbook_day`'s row read, as the actor.
 *
 * Passed through with no narrowing: the guarantee IS `readableSavedDay`'s WHERE
 * clause, and every flavour of unreachable — never existed, not yours,
 * withdrawn, not even a uuid — has to keep answering with the same "no row"
 * (ADR-042's deliberate failure mode).
 */
export const savedDayLibrary: SavedDayLibrary = {
  readable: (savedDayId, readerId) => readableSavedDay(savedDayId, readerId),
};

/**
 * `search_places`'s gazetteer — and **the door where KI-93's first half is
 * closed**.
 *
 * Three things happen here that could not happen in the kernel, which is what
 * makes this a port rather than an import:
 *
 *   1. **The vendor is constructed.** `getGeocoder()` reads `serverConfig` and
 *      throws without `LOCATIONIQ_API_KEY`, so it is behind the import wall and
 *      has to be.
 *   2. **The quota is charged, per lookup, before the lookup.** `geocodeQuota()`
 *      had exactly one caller — the `/api/geocode` proxy a person drives one
 *      button-press at a time — while the AI path, which emits lookups in
 *      bulk, was capped by nothing (KI-93). It now has two, and after
 *      `enrichCommandLocations` it has three, which is every door there is.
 *   3. **The vendor's pace is respected.** 2 requests/second, sequentially,
 *      through the same limiter the enrichment path uses.
 *
 * **A ceiling stops the rest of the batch and does not throw.** The kernel gets
 * `skipped: "quota"` on every query from the refusal onward, the tool turns
 * that into a sentence the model reads, and the model adds the stop without a
 * citation and says so. That is a recovery path; an exception would be a
 * 500 on a turn that had already found three of five places.
 *
 * **Every refusal after the first is free.** Once the ceiling is reached the
 * loop stops charging — `consumeQuota` BUMPS a counter before it compares, so
 * charging the remaining queries would inflate the user's own daily count with
 * lookups that never happened and push their next window's first request
 * further from the truth.
 *
 * **A factory, with the three edges injected** — the vendor, the charge and the
 * clock. `placeSearchPort` below is the one real instance and the only thing
 * the app wires; the parameters exist so this adapter's own behaviour (does it
 * charge before it looks up? does a ceiling stop the batch? does it pace?) is
 * testable without a database, a key or 500 ms of real wall clock per query.
 * M9 Phase 0's retro is the reason it is worth the seam: a mock is a boundary,
 * and the code on the far side of it is untested until something asserts the
 * wire — this module IS the far side of the kernel's port mock.
 */
export function createPlaceSearchPort(edges: {
  geocoder: () => Geocoder;
  charge: (userId: string) => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
}): PlaceSearchPort {
  return {
  search: async ({ queries, region, userId }) => {
    const lookups: PlaceLookup[] = [];
    // Constructed once, lazily, and only if there is something to look up: the
    // thunk throws without the key, and a turn that searched nothing must not
    // require one. Same rule `enrichCommandLocations` follows, same reason.
    let geocoder: Geocoder | null = null;
    let stopped: PlaceLookup["skipped"] | null = null;
    // **Whether the VENDOR has been contacted**, which is not the same question
    // as whether a previous query produced places. A query whose call threw
    // still spent a request against the per-second limit, so it still has to be
    // paced — reading the pacing condition off the RESULTS got that backwards,
    // and the test that was supposed to catch it asserted a case where the
    // branch is unreachable, so it stayed green under the mutation. Both are
    // fixed here; `paces the vendor…` now drives the throwing case.
    let vendorCalled = false;

    for (const query of queries) {
      if (stopped !== null) {
        lookups.push({ query, places: [], skipped: stopped });
        continue;
      }
      if (!(await edges.charge(userId))) {
        // Both flavours of refusal — the ceiling, and a counter store that
        // could not answer — read to the model as the same instruction, because
        // the useful half is "do not search again this turn".
        stopped = "quota";
        lookups.push({ query, places: [], skipped: stopped });
        continue;
      }
      // Paced BETWEEN vendor calls, never before the first and never after a
      // charge that bought nothing — a refused query contacted no vendor, so
      // sleeping for it would spend the turn's wall clock on nothing.
      if (vendorCalled) await edges.sleep(MIN_INTERVAL_MS);
      try {
        geocoder ??= edges.geocoder();
        vendorCalled = true;
        const results = await geocoder.forward(query, {
          limit: PLACE_CANDIDATES_PER_QUERY,
          ...(region === null ? {} : { viewbox: region }),
        });
        lookups.push({ query, places: results.map(asResolvedPlace).filter(isPlaceable) });
      } catch {
        // **One failed query does not stop the batch, and a missing key does.**
        // The distinction is not drawn here on purpose: both surface as
        // `unavailable` for THIS query, and the next query's `getGeocoder()`
        // throws again if the cause was the key. A vendor 500 on one name is
        // exactly the case that must not cost the other four their lookups.
        lookups.push({ query, places: [], skipped: "unavailable" });
      }
    }
    return lookups;
  },
  };
}

/**
 * The instance the app wires, and the only place the three real edges are
 * named. `consumeQuota` FAILS CLOSED on a counter-store error, which is the
 * posture the rest of the server takes on spend: "the database is down" must
 * not be the state in which the vendor key becomes free to burn.
 */
export const placeSearchPort: PlaceSearchPort = createPlaceSearchPort({
  geocoder: getGeocoder,
  charge: async (userId) => (await consumeQuota(geocodeQuota(), userId)).allowed,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
});

/**
 * A vendor result as the kernel's own vocabulary.
 *
 * `canonicalName` becomes `name` because that is the field that will be written
 * onto the stop if the model cites this candidate — see `ResolvedPlace`. The
 * optional keys are spread conditionally rather than assigned `undefined`, so
 * the object a `Location` is later built from has no keys its schema would have
 * to tolerate as present-and-undefined.
 */
function asResolvedPlace(result: GeocodeResult): Partial<ResolvedPlace> & { name: string } {
  return {
    name: result.canonicalName,
    lat: result.lat,
    lng: result.lng,
    ...(result.countryCode === undefined ? {} : { countryCode: result.countryCode }),
    ...(result.city === undefined ? {} : { city: result.city }),
    ...(result.area === undefined ? {} : { area: result.area }),
  };
}

/**
 * Whether a candidate is worth numbering.
 *
 * A candidate with no coordinates is not a place the model can cite: the whole
 * value of a citation is that the server holds a coordinate nobody guessed, so
 * numbering one without would issue a `placeRef` that resolves to a name and
 * nothing else — which is what the model could already have typed. The vendor
 * should never return one; this is the assertion, not the expectation.
 */
function isPlaceable(place: Partial<ResolvedPlace> & { name: string }): place is ResolvedPlace {
  return (
    place.name.length > 0 &&
    typeof place.lat === "number" &&
    Number.isFinite(place.lat) &&
    typeof place.lng === "number" &&
    Number.isFinite(place.lng)
  );
}
