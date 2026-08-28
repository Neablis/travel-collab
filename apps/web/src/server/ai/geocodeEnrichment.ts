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

// Padding on the box drawn around the trip's existing activities, and around a
// single model-supplied hint. The trip margin is loose because a trip legibly
// spans a region; the hint margin is tight because it describes one place.
const TRIP_REGION_MARGIN_KM = 150;
const HINT_MARGIN_KM = 50;

type LocationCommand = Extract<BatchableCommand, { type: "AddActivity" | "UpdateActivity" }>;

export interface LocationEnrichmentReport {
  // The geocoder returned a match consistent with what we already believed.
  verified: string[];
  // No match, or a match rejected as implausible. The model's own location
  // survives untouched — which may mean no coordinates at all.
  unverified: string[];
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
  unchecked: [],
  failed: [],
  skipped: [],
});

// True when the report describes something a user should be told about.
// `unchecked` is excluded by design — see the field's comment.
export function hasUnverifiedLocations(report: LocationEnrichmentReport): boolean {
  return report.unverified.length + report.failed.length + report.skipped.length > 0;
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
// (see `tripRegionOf` in handleAiRequest.ts), and bounding boxes there only
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
    report[resolution.outcome].push(name);
    // Anything we settled on is evidence about where the trip is — including a
    // rejected lookup's surviving model hint. A `failed` lookup taught us
    // nothing new, so it contributes nothing.
    if (resolution.outcome !== "failed") {
      const coords = plausibleCoords(resolution.location);
      if (coords) anchors.push(coords);
    }
    return [key, resolution] as const;
  }, sleep);
  // Keyed by normalized name, one Resolution per unique name — this is still
  // just the dedupe (one geocoder call per name), not a decision to make every
  // command sharing that name resolve identically. That decision is made
  // per-command below.
  const resolutionByKey = new Map(resolved);

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
      // "never relocate" move is to rebuild the fallback from THAT command's
      // own location — never from another command's. This must stay a
      // rebuild, not "leave the command as-is": `plausibleCoords` still needs
      // to run per command to strip a null-island 0,0 sentinel, or that gets
      // persisted again.
      const location: Location =
        resolution.outcome === "verified" || resolution.outcome === "unchecked"
          ? resolution.location
          : { name: command.location.name, ...(plausibleCoords(command.location) ?? {}) };
      return { ...command, location };
    }),
    report,
  };
}
