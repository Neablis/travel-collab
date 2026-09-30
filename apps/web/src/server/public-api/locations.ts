import { GEOCODE_OUTCOME_END_HEADER, GEOCODE_OUTCOME_HEADER, type GeocodeOutcome, type Location } from "@tc/contracts";
import { getGeocoder, type BoundingBox, type Geocoder, type GeocodeResult } from "@/server/geocoding";
import { countryFilterFor } from "@/server/geocoding/region";
import { consumeQuota, geocodeQuota, type QuotaDecision } from "@/server/quota";
import { PublicApiError } from "./commands";

// **The v1 stop-write resolution order** (decided with Mitchell, 2026-09-18):
// explicit coordinates → a geocoded address → a geocoded name → saved without
// coordinates and flagged. This is ADR-007's "pre-command enrichment": the
// domain only ever stores coordinates it is handed.
//
// **Never throws, never fails the write.** A stop an agent meant to create is
// worth more saved without a pin than refused because a vendor was down.
//
// **Charged before the vendor is called**, against the same per-user and global
// daily ceilings as the in-app search (`geocodeQuota`), so v1 cannot spend the
// LocationIQ allowance past them (unlike the assistant path, KI-093).
//
// **The caller's words win.** `name` and `address` are kept as sent; geocoding
// only adds lat/lng and fills country/city/area the caller left empty.
// `precision` stays absent (= unknown): nothing here checks what granularity
// the vendor's point describes.

/**
 * What a lookup for this trip is biased with: the box around its located stops
 * (`tripRegionOf`) and the countries they are in (`tripCountriesOf`). A name
 * lookup with no `countryCode` of its own is restricted to `countries`
 * (Mitchell, 2026-09-30); both are empty on a trip with nothing located yet.
 */
export interface ResolveContext {
  userId: string;
  region: BoundingBox | null;
  countries?: readonly string[];
}

export interface LocationResolution {
  location: Location;
  outcome: GeocodeOutcome;
}

export interface ResolveDeps {
  /** May throw when the vendor is unconfigured (no API key) → "unavailable". */
  geocoder: () => Geocoder;
  charge: (userId: string) => Promise<QuotaDecision>;
}

export const defaultResolveDeps: ResolveDeps = {
  geocoder: getGeocoder,
  charge: (userId) => consumeQuota(geocodeQuota(), userId),
};

/** The `Geocode-Outcome` header's description, shared by every endpoint that sets it. */
export const GEOCODE_OUTCOME_DOC =
  "Present when the body carried a `location`. One of: provided (you sent lat/lng), address, name " +
  "(coordinates were geocoded from that field), no-match, quota-exhausted, unavailable (the stop was " +
  "saved without coordinates — send lat/lng, or look them up with GET /v1/trips/{tripId}/geocode).";

/**
 * `Geocode-Outcome-End`: the same answer for a transit stop's `endLocation`
 * (M24). Its own header rather than a second value in the first, so
 * `Geocode-Outcome` still means exactly what it did — the two places are
 * resolved independently and can come back different.
 */
export const GEOCODE_OUTCOME_END_DOC =
  "Present when the body carried an `endLocation`. The same values as Geocode-Outcome, for that place.";

/**
 * Resolve the places a stop write carries — `location` and a transit stop's
 * `endLocation` — and answer each in its own header. Shared by `POST` and
 * `PATCH /activities` so the two cannot resolve them differently.
 *
 * Only a place the caller actually sent is resolved: absent leaves the stop
 * alone and `null` clears it, and neither is a place to look up, so neither
 * spends a geocode or sets a header. The two lookups are independent, so they
 * run concurrently.
 *
 * The caller refuses whatever the body alone can refuse first — a header is set
 * here because a lookup was paid for, and one that was never needed should not
 * have been.
 */
export async function resolveStopPlaces<T extends { location?: Location | null; endLocation?: Location | null }>(
  stop: T,
  ctx: ResolveContext,
  responseHeaders: Headers,
  deps: ResolveDeps = defaultResolveDeps,
): Promise<T> {
  const resolve = async (place: Location | null | undefined, header: string) => {
    if (place == null) return place;
    const resolved = await resolveStopLocation(place, ctx, deps);
    responseHeaders.set(header, resolved.outcome);
    return resolved.location;
  };
  const [location, endLocation] = await Promise.all([
    resolve(stop.location, GEOCODE_OUTCOME_HEADER),
    resolve(stop.endLocation, GEOCODE_OUTCOME_END_HEADER),
  ]);
  return {
    ...stop,
    ...(location != null ? { location } : {}),
    ...(endLocation != null ? { endLocation } : {}),
  };
}

export async function resolveStopLocation(
  input: Location,
  ctx: ResolveContext,
  deps: ResolveDeps = defaultResolveDeps,
): Promise<LocationResolution> {
  if (input.lat !== undefined) return { location: input, outcome: "provided" };

  let decision: QuotaDecision;
  try {
    decision = await deps.charge(ctx.userId);
  } catch {
    return { location: input, outcome: "unavailable" };
  }
  if (!decision.allowed) {
    return { location: input, outcome: decision.reason === "unavailable" ? "unavailable" : "quota-exhausted" };
  }

  let match: GeocodeResult | undefined;
  const outcome: GeocodeOutcome = input.address ? "address" : "name";
  try {
    const geocoder = deps.geocoder();
    [match] = input.address
      ? await geocoder.forwardAddress(input.address, { limit: 1 })
      : await geocoder.forward(input.name, {
          limit: 1,
          ...(ctx.region ? { viewbox: ctx.region } : {}),
          ...countryFilterFor(input.countryCode, ctx.countries ?? []),
        });
  } catch {
    return { location: input, outcome: "unavailable" };
  }
  if (!match) return { location: input, outcome: "no-match" };

  const countryCode = input.countryCode ?? input.address?.countryCode ?? match.countryCode;
  const city = input.city ?? match.city;
  const area = input.area ?? match.area;
  return {
    location: {
      ...input,
      lat: match.lat,
      lng: match.lng,
      ...(countryCode ? { countryCode } : {}),
      ...(city ? { city } : {}),
      ...(area ? { area } : {}),
    },
    outcome,
  };
}

/** What a v1 lookup answers when the geocoder is down or unconfigured: ours, and temporary. */
export const GEOCODE_UNAVAILABLE = "Geocoding is unavailable. Try again shortly.";

/**
 * The v1 refusal for a quota charge that did not allow a lookup: `503` when the
 * counter store itself failed (it fails closed), else `429` with `Retry-After`.
 * `null` when the lookup may go ahead. `message` says whose allowance ran out,
 * because the place search has two — the token's and the account's.
 */
export function lookupRefusal(decision: QuotaDecision, responseHeaders: Headers, message: string): PublicApiError | null {
  if (decision.allowed) return null;
  if (decision.reason === "unavailable") return new PublicApiError(503, GEOCODE_UNAVAILABLE, "service-unavailable");
  responseHeaders.set("Retry-After", String(decision.retryAfterSeconds));
  return new PublicApiError(429, message, "rate-limited");
}

/**
 * A vendor result as a candidate `Location` — complete, so a caller can send it
 * back as a stop's `location` unchanged and that write costs no second lookup.
 */
export function candidateLocation(result: GeocodeResult): Location {
  return {
    // A vendor's full label routinely runs past `Location.name`'s 200, and an
    // over-long name fails the response schema on the way out — i.e. a 500 for
    // a lookup that actually worked.
    name: result.canonicalName.slice(0, 200),
    lat: result.lat,
    lng: result.lng,
    ...(result.countryCode ? { countryCode: result.countryCode } : {}),
    ...(result.city ? { city: result.city } : {}),
    ...(result.area ? { area: result.area } : {}),
  };
}
