import type { GeocodeOutcome, Location } from "@tc/contracts";
import { getGeocoder, type BoundingBox, type Geocoder, type GeocodeResult } from "@/server/geocoding";
import { consumeQuota, geocodeQuota, type QuotaDecision } from "@/server/quota";

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

export async function resolveStopLocation(
  input: Location,
  ctx: { userId: string; region: BoundingBox | null },
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
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
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
