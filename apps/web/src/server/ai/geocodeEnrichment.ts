// AI-planning-specific enrichment step (ADR-007). The model is not trusted to
// supply real lat/lng, so a resolved batch's locations are looked up against a
// real geocoder before the batch is submitted.
//
// Rewritten for KI-15. The original mirrored the manual "Add a place" flow
// (LocationInput.tsx: a geocode result REPLACES what the user typed) but
// dropped the part that made that flow safe — a human picking from candidates.
// Unsupervised, it relocated a Niagara Falls dinner to Shropshire, England,
// discarding coordinates the model had gotten right, and swallowed seven
// rate-limited lookups into coordinate-less locations. Both silently.
//
// The rule now is: **enrichment may refine a location, never relocate it.**
// Every lookup is biased toward what we already believe (the model's own
// plausible coordinates, else the trip's existing activities) and its answer is
// accepted only if it agrees with that belief. Disagreement means we keep what
// we had and say so in the report.
//
// This is a floor, not the fix. The architecture still launders a model guess
// into a stored fact; M9's "Grounding" (a SearchPlaces read tool and a
// placeRef the model must cite) removes the guess. KI-15 stays open.
//
// Lives here (not under server/geocoding/) because dedupe, throttling,
// acceptance and reporting are batch-shaped AI pipeline policy, not a
// geocoding-provider concern; `geocoding/` stays a pure vendor seam.
import type { BatchableCommand, Location } from "@tc/contracts";
import type { Geocoder } from "@/server/geocoding";
import {
  boundingBoxAround,
  distanceKm,
  plausibleCoords,
  withinBox,
  TRIP_REGION_MARGIN_KM,
  type BoundingBox,
  type LatLng,
} from "@/server/ai/geocodeRegion";
import { mapRateLimited } from "@/server/ai/rateLimit";

// LocationIQ's free tier is 5,000/day but capped at 2 requests/second, and the
// per-second limit is the one that actually binds on a 9-name itinerary.
const REQUESTS_PER_SECOND = 2;
const MIN_INTERVAL_MS = 1000 / REQUESTS_PER_SECOND;

// Serialized at 500 ms apart, every lookup is wall-clock latency added to an AI
// request that is already slow. 15 caps that at ~7 s, past which the marginal
// pin is not worth the wait; the remainder keep the model's own coordinates and
// are reported as skipped rather than silently left alone.
const MAX_LOOKUPS_PER_BATCH = 15;

// How far a geocode result may sit from the model's own coordinates and still
// count as "the same place, located more precisely". Generous enough for a
// vaguely-placed restaurant inside a metro area, nowhere near enough to cross
// an ocean.
const MAX_REFINE_KM = 50;

// Padding around a single model-supplied hint. Tight, because it describes one
// place — where `TRIP_REGION_MARGIN_KM` (imported above, stated once in
// geocodeRegion.ts) is loose because a trip legibly spans a region.
const HINT_MARGIN_KM = 50;

type LocationCommand = Extract<BatchableCommand, { type: "AddActivity" | "UpdateActivity" }>;

export interface LocationEnrichmentReport {
  // The geocoder returned a match consistent with what we already believed.
  verified: string[];
  // No match, or a match rejected as implausible, AND nothing better to fall
  // back to. The model's own location survives untouched — which may mean no
  // coordinates at all.
  unverified: string[];
  // The venue lookup came back with nothing usable, but the location named a
  // city and country the geocoder COULD corroborate, so the stop is pinned at
  // that city's centroid and carries `precision: "city"`.
  //
  // Its own bucket rather than a flavour of `unverified`, because the two are
  // different answers to the user: a city-level stop is on the map, roughly
  // right, and honest about it; an `unverified` one is not on the map at all.
  // `unverifiedNotice` (writeTools.ts) is built from `unverified`/`failed`/
  // `skipped`, so a name left in those would be read back as "I couldn't
  // verify the location for X" about a stop we had in fact just placed.
  cityLevel: string[];
  // Accepted, but there was nothing to check it against: no model hint, and no
  // region yet. Only reachable for the FIRST lookup of a trip that has no
  // geocoded activities — after that, bootstrapping supplies a region. Reported
  // for honesty but deliberately NOT surfaced to the user: on a freshly planned
  // trip it would otherwise fire on every location, every time.
  unchecked: string[];
  // The lookup threw: rate limit, vendor outage, missing API key.
  failed: string[];
  // Never attempted — over MAX_LOOKUPS_PER_BATCH.
  skipped: string[];
}

const emptyReport = (): LocationEnrichmentReport => ({
  verified: [],
  unverified: [],
  cityLevel: [],
  unchecked: [],
  failed: [],
  skipped: [],
});

// True when the report describes something a user should be told about.
// `unchecked` and `cityLevel` are both excluded by design — see their fields'
// comments. `cityLevel` is the load-bearing one: it is the outcome this
// function's caller would otherwise describe as a place it could not verify,
// which is the opposite of what happened.
export function hasUnverifiedLocations(report: LocationEnrichmentReport): boolean {
  return report.unverified.length + report.failed.length + report.skipped.length > 0;
}

// True when the batch placed something at city level. Its own predicate rather
// than a widening of the one above, and that is not tidiness: the sentence
// `hasUnverifiedLocations` gates draws its names from `unverified`/`failed`/
// `skipped`, so counting `cityLevel` there would produce "I couldn't verify
// locations for  — worth checking on the map" with an empty name list.
export function hasCityLevelLocations(report: LocationEnrichmentReport): boolean {
  return report.cityLevel.length > 0;
}

// "Needs enrichment" = AddActivity/UpdateActivity with a `location` object
// present. UpdateActivity's `location: null` means "clear it" — nothing to
// geocode there — and `undefined` means "unchanged" on both command types.
function hasLocation(command: BatchableCommand): command is LocationCommand & { location: Location } {
  return (command.type === "AddActivity" || command.type === "UpdateActivity") && command.location != null;
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The approved location, with only its COORDINATES re-derived.
 *
 * Field-agnostic by construction — it spreads rather than enumerating — so a
 * field added to `Location` later survives enrichment without anyone
 * remembering to come back here. That is deliberate: hand-enumerated activity
 * fields are a standing defect class in this repo (KI-2026-09-05-o), and this
 * function is on the path where forgetting one turns a real edit into a no-op.
 *
 * The coordinates are the one thing that cannot simply be carried: a model
 * that does not know a coordinate emits the null-island `0,0` sentinel, and
 * `plausibleCoords` has to run per command to strip it or it is persisted as
 * a real pin. Dropping a bad COORDINATE is not subtraction — it is refusing a
 * value that was never information.
 */
function sanitizeCoords(location: Location): Location {
  const coords = plausibleCoords(location);
  if (coords) return { ...location, ...coords };
  // An implausible pair is dropped rather than carried: a null-island 0,0 is
  // not a coordinate the model knew, and persisting it draws a real pin in the
  // Gulf of Guinea.
  //
  // `precision` goes with it, by the same argument one level up: the field says
  // what the COORDINATES describe, so with no coordinates left it describes
  // nothing. Keeping it would leave a location claiming `precision: "venue"`
  // and carrying no venue — a claim about a value that is no longer there.
  const withoutCoords = { ...location };
  delete withoutCoords.lat;
  delete withoutCoords.lng;
  delete withoutCoords.precision;
  return withoutCoords;
}

type Outcome = "verified" | "unverified" | "unchecked" | "failed";

interface Resolution {
  location: Location;
  outcome: Outcome;
}

// One lookup, biased and then judged.
//
// `hint` is the model's own coordinates for this place when they are
// plausible. `region` is broader, independently-sourced evidence about where
// the trip is: either its own already-geocoded activities, or — early in a
// batch, before any of those exist — the coordinates accepted earlier in this
// same batch (see the bootstrapping in `enrichCommandLocations`).
//
// A geocoder answer is accepted only if it agrees with EVERY belief we hold,
// not just the strongest one. This is the fix for the final-review finding
// (KI-15's second bug): the original version treated `hint` as categorically
// stronger than `region` and never consulted `region` at all once a `hint`
// existed. That let a WRONG hint that merely happened to sit near the
// geocoder's top result get reported `verified` — with a 150km trip region
// sitting right there, unconsulted, that would have caught it. Because a
// `verified` location is what a later request's `tripRegion` gets built from
// (see `tripRegionOf` in geocodeRegion.ts), and bounding boxes there only
// ever grow, that one bad `verified` would have permanently widened the trip's
// region to admit the mistake, for every future AI request on that trip.
//
// JUDGMENT CALL — what "disagreement" between hint and region means before
// the geocoder is even consulted: if `hint` sits outside `region`, `hint` is
// treated as UNTRUSTED for this lookup — for both the viewbox and the
// acceptance test — and judgment falls back to `region` alone, as though no
// hint had been supplied. The alternative (region as just one more box to
// intersect, hint still driving the viewbox) was rejected: biasing the
// geocoder's *search* toward a hint we already doubt is exactly how a wrong
// hint manufactures its own corroboration — center the search on Shropshire
// and "top result near Shropshire" stops being informative. Note this is NOT
// the same as discarding the hint outright: an untrusted hint still survives
// as `fallback` below if nothing can be verified, because "never relocate"
// means keeping the model's own guess even when we can't confirm it. We only
// refuse to let a doubted hint validate a geocoder match on its own authority.
//
// With no hint at all, judgment is `region`-only, same as an untrusted hint.
// With neither hint nor region, there is nothing to check the top match
// against, so it is accepted but reported `unchecked` — never `verified`.
async function resolveOne(
  geocoder: Geocoder,
  name: string,
  hint: LatLng | null,
  region: BoundingBox | null,
): Promise<Resolution> {
  const fallback: Location = hint ? { name, lat: hint.lat, lng: hint.lng } : { name };
  const hintTrusted = hint != null && (region == null || withinBox(region, hint));
  const viewbox = hintTrusted ? boundingBoxAround([hint], HINT_MARGIN_KM) : region;

  let match;
  try {
    [match] = await geocoder.forward(name, { limit: 1, ...(viewbox ? { viewbox } : {}) });
  } catch {
    // Best-effort by contract: a vendor failure never fails the AI request. It
    // is reported rather than swallowed, which is the half KI-15 was missing.
    return { location: fallback, outcome: "failed" };
  }
  if (!match) return { location: fallback, outcome: "unverified" };

  const found: Location = {
    name: match.canonicalName,
    lat: match.lat,
    lng: match.lng,
    // The vendor answered a VENUE query with a place, so that is what its
    // coordinate describes — on both accepting paths, `verified` and
    // `unchecked` alike. `unchecked` is a venue-level answer we happened to
    // have nothing to cross-check, not a coarser one, and the report is where
    // "we could not check it" is already recorded. Overloading `precision`
    // with that would turn a field about WHAT a coordinate describes into a
    // verdict on how much we trust it, which contracts/src/activity.ts is
    // explicit that it is not.
    precision: "venue",
    ...(match.countryCode ? { countryCode: match.countryCode } : {}),
    ...(match.city ? { city: match.city } : {}),
    ...(match.area ? { area: match.area } : {}),
  };
  const matchPoint: LatLng = { lat: match.lat, lng: match.lng };

  if (hintTrusted) {
    // Belt and suspenders: a trusted hint already sits inside `region` (that
    // is what "trusted" means), so a match within MAX_REFINE_KM of it will
    // almost always also be within `region`. Checking both anyway catches the
    // rare case where the hint sits near the region's own edge and the match
    // is just far enough past it.
    const agreesWithHint = distanceKm(hint!, matchPoint) <= MAX_REFINE_KM;
    const agreesWithRegion = region == null || withinBox(region, matchPoint);
    return agreesWithHint && agreesWithRegion
      ? { location: found, outcome: "verified" }
      : { location: fallback, outcome: "unverified" };
  }
  if (region) {
    return withinBox(region, matchPoint)
      ? { location: found, outcome: "verified" }
      : { location: fallback, outcome: "unverified" };
  }
  // Nothing to check against. Take it, but do not claim it was verified — and
  // do not nag the user about it either (see LocationEnrichmentReport).
  return { location: found, outcome: "unchecked" };
}

// The city half of a fallback (KI-2026-08-30-f). One lookup, judged by the
// SAME region test a venue match faces — a "Springfield, US" the geocoder puts
// three states from the trip is it answering about a different Springfield, and
// accepting it would pin the stop in the wrong place, which is the one thing
// this module may never do. With no region at all there is nothing to check
// against, so the answer is taken: the same call `resolveOne` makes when it
// reports `unchecked`.
//
// Returns a bare coordinate, not a `Location`: the stop is still the venue the
// human approved, placed roughly. Letting the city's own `canonicalName` and
// address components overwrite the approved ones would rename "PNB bakery" to
// "Jeonju-si" — a relocation of the label rather than of the pin, and just as
// wrong.
async function resolveCityCoords(
  geocoder: Geocoder,
  query: string,
  region: BoundingBox | null,
): Promise<LatLng | null> {
  let match;
  try {
    [match] = await geocoder.forward(query, { limit: 1, ...(region ? { viewbox: region } : {}) });
  } catch {
    // Best-effort, exactly like the venue lookup: a vendor failure here costs
    // the stop its city-level pin and nothing else.
    return null;
  }
  if (!match) return null;
  const point = plausibleCoords(match);
  if (!point) return null;
  if (region && !withinBox(region, point)) return null;
  return point;
}

// The query a city fallback sends, and the key that dedupes it across the
// batch. `"<city>, <countryCode>"` is what a person types into the manual flow,
// and it is a question the vendor can answer even when the venue is not in OSM
// at all.
function cityLookupOf(location: Location): { key: string; query: string } | null {
  const { city, countryCode } = location;
  if (!city || !countryCode) return null;
  return { key: `${normalize(city)}|${countryCode.toUpperCase()}`, query: `${city}, ${countryCode}` };
}

export async function enrichCommandLocations(
  commands: BatchableCommand[],
  getGeocoder: () => Geocoder,
  tripRegion: BoundingBox | null = null,
  sleep?: (ms: number) => Promise<void>,
): Promise<{ commands: BatchableCommand[]; report: LocationEnrichmentReport }> {
  // Dedupe by normalized name, keeping the first spelling and the first
  // plausible coordinate hint seen for it. This drives the ONE shared
  // geocoder lookup per unique name and nothing else — it is not the source
  // of truth for any individual command's final location. See the per-command
  // resolution in the final `.map()` below for why that distinction matters.
  const pending = new Map<string, { name: string; hint: LatLng | null }>();
  for (const command of commands) {
    if (!hasLocation(command)) continue;
    const key = normalize(command.location.name);
    const existing = pending.get(key);
    const hint = plausibleCoords(command.location);
    if (!existing) {
      pending.set(key, { name: command.location.name, hint });
    } else if (!existing.hint && hint) {
      existing.hint = hint;
    }
  }

  const report = emptyReport();
  if (pending.size === 0) return { commands, report };

  const entries = Array.from(pending.entries());
  const attempted = entries.slice(0, MAX_LOOKUPS_PER_BATCH);
  for (const [, { name }] of entries.slice(MAX_LOOKUPS_PER_BATCH)) report.skipped.push(name);

  const geocoder = getGeocoder();

  // One clock for the whole function. `mapRateLimited` has its own default, but
  // the bridge between the two lookup passes below has to sleep on the same one
  // — including in tests, which inject a no-op so they neither wait nor need
  // fake timers.
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  // Region bootstrapping. A brand-new trip has no geocoded activities, so
  // `tripRegion` is null and the first lookup has nothing to check against.
  // Lookups are sequential, though, so every coordinate we settle on tells the
  // rest of the batch where this trip is — the Rochester run anchors on
  // whichever place resolves first, and a Shropshire match for the next name is
  // then rejected on region alone, with no model hint needed. Only the first
  // lookup of a region-less trip can come back `unchecked`.
  const anchors: LatLng[] = [];
  const resolved = await mapRateLimited(attempted, MIN_INTERVAL_MS, async ([key, { name, hint }]) => {
    const region = tripRegion ?? boundingBoxAround(anchors, TRIP_REGION_MARGIN_KM);
    const resolution = await resolveOne(geocoder, name, hint, region);
    // Anything we settled on is evidence about where the trip is — including a
    // rejected lookup's surviving model hint. A `failed` lookup taught us
    // nothing new, so it contributes nothing.
    if (resolution.outcome !== "failed") {
      const coords = plausibleCoords(resolution.location);
      if (coords) anchors.push(coords);
    }
    return [key, resolution] as const;
  }, wait);
  // Keyed by normalized name, one Resolution per unique name — this is still
  // just the dedupe (one geocoder call per name), not a decision to make every
  // command sharing that name resolve identically. That decision is made
  // per-command below.
  const resolutionByKey = new Map(resolved);

  // --- The city-level fallback (KI-2026-08-30-f) ---
  //
  // Our geocoder is OpenStreetMap-derived and structurally cannot corroborate a
  // small independent venue: eight of the Japan fixture's stops return a
  // definitive 404 on every rerun, and a well-planned real trip is full of
  // exactly that class. So "the venue lookup found nothing" is the COMMON case,
  // and its old answer — keep whatever the model gave us, which is often no
  // coordinates at all — left the stop off the map entirely.
  //
  // The city the model named is a far easier question, and one the vendor can
  // answer. So ask it, and pin the stop at the city's centroid marked
  // `precision: "city"` so nothing downstream can mistake it for a located
  // venue. Which is a real answer: "somewhere in Jeonju-si" is what the user
  // already knew and what they asked us to put on a map.
  //
  // Only for a stop with NO usable coordinates of its own. Replacing a
  // plausible model coordinate with a city centroid would MOVE a pin, which
  // this module may never do (KI-15), and would trade a guess about this venue
  // for a fact about somewhere the venue merely sits inside.
  //
  // Per COMMAND, not per deduped name: two commands can share a venue name and
  // carry different cities, and applying one command's city to another's stop is
  // the relocation bug the per-command resolution below already exists to
  // prevent.
  const cityQueries = new Map<string, string>();
  const wantsCity = new Map<BatchableCommand, { cityKey: string; nameKey: string }>();
  for (const command of commands) {
    if (!hasLocation(command)) continue;
    const nameKey = normalize(command.location.name);
    const outcome = resolutionByKey.get(nameKey)?.outcome;
    if (outcome !== "unverified" && outcome !== "failed") continue;
    if (plausibleCoords(command.location)) continue;
    const lookup = cityLookupOf(command.location);
    if (!lookup) continue;
    wantsCity.set(command, { cityKey: lookup.key, nameKey });
    if (!cityQueries.has(lookup.key)) cityQueries.set(lookup.key, lookup.query);
  }

  // City lookups spend the SAME per-batch budget as venue lookups and go
  // through the SAME throttle. Both caps are about the request the user is
  // waiting on and the vendor's 2/second ceiling, neither of which cares which
  // kind of question is being asked. Over-budget cities are simply not looked
  // up: the stops they would have served are already reported `unverified`, and
  // naming a CITY in a report whose every other entry is a stop name would read
  // as a stop we failed on.
  const cityBudget = Math.max(0, MAX_LOOKUPS_PER_BATCH - attempted.length);
  const cityCoords = new Map<string, LatLng>();
  if (cityQueries.size > 0 && cityBudget > 0) {
    // Checked against everything the venue pass settled on, which is strictly
    // more evidence than any single lookup inside that pass had.
    const region = tripRegion ?? boundingBoxAround(anchors, TRIP_REGION_MARGIN_KM);
    // `mapRateLimited` sleeps BETWEEN its own items, so a second pass would
    // fire its first lookup with no gap after the venue pass's last one —
    // three calls inside one second, over the ceiling. One explicit sleep
    // bridges the passes, so the batch is throttled as a whole rather than
    // twice separately.
    await wait(MIN_INTERVAL_MS);
    const resolvedCities = await mapRateLimited(
      Array.from(cityQueries.entries()).slice(0, cityBudget),
      MIN_INTERVAL_MS,
      async ([key, query]) => [key, await resolveCityCoords(geocoder, query, region)] as const,
      wait,
    );
    for (const [key, coords] of resolvedCities) if (coords) cityCoords.set(key, coords);
  }

  // Which commands actually took a city pin, and therefore which NAMES are
  // reported city-level rather than unverified.
  const cityPins = new Map<BatchableCommand, LatLng>();
  // Per NAME, what happened across every command that wanted a city pin for it:
  // `pinned` if any of them got one, `unpinned` if any of them did not. Both
  // can be true at once — see the report loop below.
  const cityOutcomeByName = new Map<string, { pinned: boolean; unpinned: boolean }>();
  for (const [command, { cityKey, nameKey }] of wantsCity) {
    const coords = cityCoords.get(cityKey);
    if (coords) cityPins.set(command, coords);
    const entry = cityOutcomeByName.get(nameKey) ?? { pinned: false, unpinned: false };
    if (coords) entry.pinned = true;
    else entry.unpinned = true;
    cityOutcomeByName.set(nameKey, entry);
  }

  // The report is decided here rather than inside the lookup pass, because a
  // name's outcome is not known until the city fallback has had its turn.
  // Order still follows the lookup order, so `skipped` (pushed above, before
  // any lookup ran) and these read as the batch happened.
  for (const [key, { name }] of attempted) {
    const outcome = resolutionByKey.get(key)!.outcome;
    // A name is not one outcome once two commands can share it. Two stops both
    // called "Lunch" in different cities dedupe to ONE venue lookup, then take
    // DIFFERENT city lookups — so the name can be pinned for one command and
    // pinned for neither the other. Reporting only `cityLevel` in that case
    // left `hasUnverifiedLocations` false, and the receipt told the user
    // nothing about the stop that got no pin at all. Raised by CodeRabbit on
    // PR 169; it is the same name-keyed/command-keyed seam the fallback rebuild
    // above already warns about.
    //
    // Both buckets, when both happened. The single-command case — every batch
    // anyone has actually run — is unchanged.
    const city = cityOutcomeByName.get(key);
    if (city?.pinned) report.cityLevel.push(name);
    if (!city || city.unpinned) report[outcome].push(name);
  }

  return {
    commands: commands.map((command) => {
      if (!hasLocation(command)) return command;
      const resolution = resolutionByKey.get(normalize(command.location.name));
      if (!resolution) return command;
      // `verified`/`unchecked` both carry a real geocoder match (`found`,
      // stored as `resolution.location`) keyed only by name — reusing it
      // across every command sharing that name is the intended dedupe: one
      // real-world place, one lookup, applied everywhere it was asked for.
      //
      // `unverified`/`failed` carry a FALLBACK instead, and the bug (final
      // whole-branch review) was reusing that fallback the same way: it was
      // built from whichever command's hint happened to dedupe first, then
      // stamped onto every other command sharing the name — discarding a
      // second command's own, genuinely different coordinates. Two commands
      // sharing a display name are not guaranteed to be the same place (the
      // model may not bother disambiguating "Lunch in Rochester, NY" across
      // two different days), so when we can't verify anything, the safest
      // "never relocate" move is to keep THAT command's own location — never
      // another command's.
      //
      // Both branches now go through `sanitizeCoords`, and the verified match
      // is spread OVER it rather than replacing it. That is the enrichment
      // invariant stated as code: **refine, never subtract** — what commits is
      // always at least as informative as what the human approved. It is the
      // fallback's whole job on the unverified path, and it closes the same
      // hole on the refine path, where a vendor answer with no city-level
      // component used to cost the user a city they had asked for.
      const approved = sanitizeCoords(command.location);
      if (resolution.outcome === "verified" || resolution.outcome === "unchecked") {
        return { ...command, location: { ...approved, ...resolution.location } };
      }
      // A city centroid, and said to be one. Additive by construction: it only
      // ever reaches a location that had no usable coordinate of its own, every
      // field the human approved is still here, and `precision` is overwritten
      // rather than merged so a location cannot claim a venue-level pin it no
      // longer has. A stop with no city pin keeps `precision` exactly as
      // approved — ABSENT for a surviving model guess, which is the whole point
      // of absent meaning unknown (contracts/src/activity.ts).
      const pin = cityPins.get(command);
      const location: Location = pin ? { ...approved, ...pin, precision: "city" } : approved;
      return { ...command, location };
    }),
    report,
  };
}
