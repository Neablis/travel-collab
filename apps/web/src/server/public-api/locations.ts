import { GEOCODE_OUTCOME_END_HEADER, GEOCODE_OUTCOME_HEADER, type GeocodeOutcome, type Location } from "@tc/contracts";
import { getGeocoder, type BoundingBox, type Geocoder, type GeocodeResult, type LatLng } from "@/server/geocoding";
import { countryAtPoint } from "@/server/geocoding/countryAt";
import { countryFilterFor, plausibleCoords } from "@/server/geocoding/region";
import { judgeMatch, nameQueryOf } from "@/server/ai/placeAcceptance";
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
// **The caller's words win, except for the country.** `name` and `address`
// are kept as sent; geocoding only adds lat/lng and fills city/area the caller
// left empty. `precision` stays absent (= unknown) on a venue answer: nothing
// here checks what granularity the vendor's point describes.
//
// **A name lookup's answer is judged before it is stored** (KI-2026-11-03).
// It used to be the vendor's top hit, unchecked, and Ria's Wines was pinned in
// Atlanta. Now it goes through the same rule as the assistant's enrichment
// (`placeAcceptance.ts`): the answer's own name must not be a different
// place's, and it must sit inside the trip's region, unless the caller named
// a country the trip has no stop in yet. A refused answer is never stored. The stop is pinned at its
// city's centre (`precision: "city"`, outcome `city`) when it names a city and
// a country, and is otherwise saved without coordinates (`rejected`). An
// `address` lookup is not judged this way: the address is the caller's own
// structured claim, its country already filters the lookup, and the vendor's
// label for an address is not a venue name to compare.
//
// **A stop's country is where that stop is** (Mitchell, 2026-10-29: *"only
// where every activities address is based in"*): its `address`'s country when
// it has one, else the country at its own pin, and never what the caller or
// the rest of the trip says. Five Finger Lakes stops were stored on 2026-10-03
// with correct New York coordinates and `countryCode: "JP"`, so every card
// read "Ithaca, Japan" and the trip's country hint (`tripCountriesOf`) gained
// Japan for every later lookup. The check is offline unless the caller and the
// bundled borders disagree, so a correct write spends nothing (`countryAtPin`).

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
  "(coordinates were geocoded from that field), city (the name lookup's answer was refused, and the stop " +
  "is pinned at the centre of its `city` with `precision: \"city\"`), rejected, no-match, quota-exhausted, " +
  "unavailable (the stop was saved without coordinates — send lat/lng, or look them up with " +
  "GET /v1/trips/{tripId}/geocode). `rejected` means the lookup answered with a place whose name is a " +
  "different place's, or one outside the area of the trip's other stops (unless you sent a `countryCode` the " +
  "trip has no other stop in).";

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
  const resolve = async (place: Location | null | undefined, header: string, placeCtx: ResolveContext) => {
    if (place == null) return place;
    const resolved = await resolveStopLocation(place, placeCtx, deps);
    responseHeaders.set(header, resolved.outcome);
    return resolved.location;
  };
  const [location, endLocation] = await Promise.all([
    resolve(stop.location, GEOCODE_OUTCOME_HEADER, ctx),
    // A travel leg's far end is judged without the trip's region, as the
    // assistant judges it (KI-2026-09-25-m): Odawara → Kyoto is ~290 km, and a
    // flight to a new country is a continent, so the box would refuse every
    // real destination. The name check still applies.
    resolve(stop.endLocation, GEOCODE_OUTCOME_END_HEADER, { ...ctx, region: null }),
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
  if (input.lat !== undefined) return { location: await countryAtPin(input, ctx, deps), outcome: "provided" };

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
  if (!input.address) {
    // The trip's region is the geographic check, with one exception: a
    // country the caller named that the trip has no located stop in yet. That
    // is a stop in a new country (a Seoul day on a Japan trip), the region
    // cannot speak for it, and the named country already filtered the lookup
    // and is never widened (`forward`). A country the trip IS in does not lift
    // the region: "US" on a Finger Lakes trip would otherwise admit Atlanta.
    const newCountry = input.countryCode !== undefined && !(ctx.countries ?? []).includes(input.countryCode);
    const region = newCountry ? null : ctx.region;
    const verdict = judgeMatch(nameQueryOf(input), match, { hint: null, region });
    if (verdict === "wrong-place" || verdict === "wrong-name") return cityFallback(input, ctx, deps);
  }

  // The address's country, else the matched point's. The caller's own field
  // is the last resort, for a match that came back with no country.
  const countryCode = input.address?.countryCode ?? match.countryCode ?? input.countryCode;
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

/**
 * A stop whose venue answer was refused, pinned at the centre of the city it
 * names — the assistant's city fallback (KI-2026-08-30-f), for one write.
 *
 * Only for a location naming both a `city` and a `countryCode`: the query is
 * `"<city>, <countryCode>"`, which a vendor can answer when it holds no venue
 * of that name, and the country keeps it from answering about a same-named city
 * elsewhere. It is a second lookup, charged like the first. The answer is the
 * city's coordinates and nothing else: the stop keeps its own name, city and
 * country, and says what the pin is (`precision: "city"`).
 *
 * Anything that stops it (no city or country, no quota, the vendor failing or
 * finding nothing) leaves the stop without coordinates, reported `rejected`:
 * the venue answer was refused, which is the fact a caller has to act on.
 */
async function cityFallback(input: Location, ctx: ResolveContext, deps: ResolveDeps): Promise<LocationResolution> {
  const rejected: LocationResolution = { location: input, outcome: "rejected" };
  if (!input.city || !input.countryCode) return rejected;
  try {
    if (!(await deps.charge(ctx.userId)).allowed) return rejected;
    const [match] = await deps.geocoder().forward(`${input.city}, ${input.countryCode}`, {
      limit: 1,
      countryCode: input.countryCode,
      ...(ctx.region ? { viewbox: ctx.region } : {}),
    });
    const point = match ? plausibleCoords(match) : null;
    if (!point) return rejected;
    return { location: { ...input, ...point, precision: "city" }, outcome: "city" };
  } catch {
    return rejected;
  }
}

/**
 * A caller's coordinates with the country actually at them, filled when the
 * caller sent none and corrected when it sent another.
 *
 * **Every stop is checked, whatever else is on the trip.** A trip's other stops
 * say nothing about where this one is, so a country can be wrong on a trip that
 * already holds it (the Finger Lakes trip now holds Japan).
 *
 * **Offline first, so a correct write spends nothing.** `countryAtPoint` reads
 * bundled borders: when it agrees with the caller, or the caller sent no
 * country, its answer is stored with no vendor call and no quota charge. That
 * keeps the rule this module started with, that a write with coordinates does
 * not spend the LocationIQ allowance. Only a disagreement, or a point outside
 * every bundled border, asks LocationIQ's `reverse` (one charged lookup),
 * because a pin near a border is where the simplified borders can be wrong.
 * When that lookup can't run (no quota, a vendor failure, no `reverse`,
 * nothing at the point), the offline answer stands, else what the caller sent.
 *
 * Skipped when the location has an `address`, because `Location` refines its
 * `countryCode` to equal the address's and the address is the caller's
 * authored text, not a value we may overwrite.
 */
async function countryAtPin(input: Location, ctx: ResolveContext, deps: ResolveDeps): Promise<Location> {
  if (input.address || input.lat === undefined || input.lng === undefined) return input;
  const point = { lat: input.lat, lng: input.lng };

  const offline = countryAtPoint(point);
  if (offline && (input.countryCode === undefined || offline === input.countryCode)) {
    return withCountry(input, offline);
  }
  const country = (await vendorCountryAt(point, ctx, deps)) ?? offline;
  return country ? withCountry(input, country) : input;
}

/** LocationIQ's country at a point, charged; null when the lookup can't run or finds nothing. */
async function vendorCountryAt(point: LatLng, ctx: ResolveContext, deps: ResolveDeps): Promise<string | null> {
  try {
    // Asked of the geocoder before the charge, so one that cannot answer spends nothing.
    const geocoder = deps.geocoder();
    if (!geocoder.reverse || !(await deps.charge(ctx.userId)).allowed) return null;
    return (await geocoder.reverse(point))?.countryCode ?? null;
  } catch {
    return null;
  }
}

function withCountry(input: Location, countryCode: string): Location {
  return input.countryCode === countryCode ? input : { ...input, countryCode };
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
