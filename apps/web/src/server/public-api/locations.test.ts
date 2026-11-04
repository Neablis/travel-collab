import { describe, expect, it, vi } from "vitest";
import { Location } from "@tc/contracts";
import type { Geocoder } from "@/server/geocoding";
import type { QuotaDecision } from "@/server/quota";
import { resolveStopLocation, resolveStopPlaces, type ResolveDeps } from "./locations";

const HIT = {
  lat: 49.41,
  lng: 8.69,
  canonicalName: "Hauptstraße 5, 69117 Heidelberg, Germany",
  countryCode: "DE",
  city: "Heidelberg",
  area: "Altstadt",
};
const ctx = { userId: "u1", region: null };

function deps(
  overrides: Partial<Geocoder> = {},
  decision: QuotaDecision = { allowed: true },
): ResolveDeps & { g: Geocoder; charge: ResolveDeps["charge"] } {
  const g: Geocoder = { forward: vi.fn(async () => [HIT]), forwardAddress: vi.fn(async () => [HIT]), ...overrides };
  const charge = vi.fn(async () => decision);
  return { geocoder: () => g, charge, g };
}

describe("resolveStopLocation", () => {
  it("explicit coordinates win: no lookup, no quota charge, address kept", async () => {
    const d = deps();
    const input = { name: "Museum", lat: 1, lng: 2, address: { countryCode: "DE", lines: ["Hauptstraße 5"] } };
    const r = await resolveStopLocation(input, ctx, d);
    expect(r).toEqual({ location: input, outcome: "provided" });
    expect(d.charge).not.toHaveBeenCalled();
    expect(d.g.forward).not.toHaveBeenCalled();
    expect(d.g.forwardAddress).not.toHaveBeenCalled();
  });

  it("an address beats a name, and the caller's name and address are kept verbatim", async () => {
    const d = deps();
    const address = { countryCode: "DE", lines: ["Hauptstraße 5"], locality: "Heidelberg" };
    const r = await resolveStopLocation({ name: "Dinner", address }, ctx, d);
    expect(r.outcome).toBe("address");
    expect(d.g.forwardAddress).toHaveBeenCalledWith(address, { limit: 1 });
    expect(d.g.forward).not.toHaveBeenCalled();
    expect(r.location).toEqual({
      name: "Dinner",
      address,
      lat: 49.41,
      lng: 8.69,
      countryCode: "DE",
      city: "Heidelberg",
      area: "Altstadt",
    });
    expect(r.location.precision).toBeUndefined(); // absent = unknown; we did not verify granularity
  });

  // Location refines `countryCode === address.countryCode`, so taking the
  // vendor's country over the address's would produce a location that fails
  // its own contract on the way back out.
  it("a vendor country that disagrees with the address does not win", async () => {
    const d = deps({ forwardAddress: vi.fn(async () => [{ ...HIT, countryCode: "FR" }]) });
    const address = { countryCode: "DE", lines: ["Hauptstraße 5"] };
    const r = await resolveStopLocation({ name: "Dinner", address }, ctx, d);
    expect(Location.parse(r.location).countryCode).toBe("DE");
  });

  it("a name alone is geocoded, biased to the trip region and the caller's country", async () => {
    const d = deps({ forward: vi.fn(async () => [{ ...HIT, canonicalName: "Fushimi Inari Taisha, Fushimi Ward, Kyoto, Japan" }]) });
    const region = { minLat: 34, maxLat: 36, minLng: 135, maxLng: 136 };
    const r = await resolveStopLocation({ name: "Fushimi Inari", countryCode: "JP" }, { userId: "u1", region }, d);
    expect(r.outcome).toBe("name");
    expect(d.g.forward).toHaveBeenCalledWith("Fushimi Inari", { limit: 1, viewbox: region, countryCode: "JP" });
    // The matched point's country, not the caller's: a stop's country is where
    // it is. (A real lookup filtered to JP cannot answer DE; the stub can.)
    expect(r.location.countryCode).toBe("DE");
  });

  it("a name with no country of its own is restricted to the trip's countries; one with a country is not", async () => {
    const d = deps();
    const trip = { userId: "u1", region: null, countries: ["JP", "KR"] };
    await resolveStopLocation({ name: "Ichiran" }, trip, d);
    expect(d.g.forward).toHaveBeenLastCalledWith("Ichiran", { limit: 1, countryCodes: ["JP", "KR"] });
    await resolveStopLocation({ name: "Ichiran", countryCode: "US" }, trip, d);
    expect(d.g.forward).toHaveBeenLastCalledWith("Ichiran", { limit: 1, countryCode: "US" });
  });

  it("the vendor only fills the display fields the caller left empty", async () => {
    const d = deps({ forward: vi.fn(async () => [{ ...HIT, canonicalName: "Zum Roten Ochsen, Hauptstraße 217, Heidelberg, Germany" }]) });
    const r = await resolveStopLocation({ name: "Zum Roten Ochsen", city: "Heidelberg-Handschuhsheim", area: "Neuenheim" }, ctx, d);
    expect(r.location).toEqual({ name: "Zum Roten Ochsen", city: "Heidelberg-Handschuhsheim", area: "Neuenheim", lat: 49.41, lng: 8.69, countryCode: "DE" });
  });

  it("charges the quota exactly once per lookup, to the token owner", async () => {
    const d = deps();
    await resolveStopLocation({ name: "X" }, ctx, d);
    expect(d.charge).toHaveBeenCalledTimes(1);
    expect(d.charge).toHaveBeenCalledWith("u1");
  });

  it("no match: saved unchanged, flagged no-match", async () => {
    const d = deps({ forward: vi.fn(async () => []) });
    const r = await resolveStopLocation({ name: "Nowhere" }, ctx, d);
    expect(r).toEqual({ location: { name: "Nowhere" }, outcome: "no-match" });
  });

  // Both spend refusals `consumeQuota` can return — the actor's own daily
  // ceiling and the deployment-wide one — are the same answer to the caller:
  // nothing was looked up, and the stop was saved without coordinates.
  it.each(["user", "global"] as const)("quota spent (%s): no vendor call, flagged quota-exhausted", async (reason) => {
    const d = deps({}, { allowed: false, reason, retryAfterSeconds: 3600 });
    const r = await resolveStopLocation({ name: "X" }, ctx, d);
    expect(r.outcome).toBe("quota-exhausted");
    expect(d.g.forward).not.toHaveBeenCalled();
  });

  it("quota store down: fails closed as unavailable, no vendor call", async () => {
    const d = deps({}, { allowed: false, reason: "unavailable", retryAfterSeconds: 60 });
    const r = await resolveStopLocation({ name: "X" }, ctx, d);
    expect(r.outcome).toBe("unavailable");
    expect(d.g.forward).not.toHaveBeenCalled();
  });

  it("the charge itself throwing is also fail-closed: unavailable, no vendor call", async () => {
    const d = deps();
    const charge = vi.fn(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    const r = await resolveStopLocation({ name: "X" }, ctx, { ...d, charge });
    expect(r).toEqual({ location: { name: "X" }, outcome: "unavailable" });
    expect(d.g.forward).not.toHaveBeenCalled();
  });

  it("vendor throws or geocoder unconfigured: saved unchanged, flagged unavailable, never throws", async () => {
    const throwing = deps({
      forward: vi.fn(async () => {
        throw new Error("geocode failed: 500");
      }),
    });
    await expect(resolveStopLocation({ name: "X" }, ctx, throwing)).resolves.toEqual({
      location: { name: "X" },
      outcome: "unavailable",
    });
    const unconfigured: ResolveDeps = {
      geocoder: () => {
        throw new Error("LOCATIONIQ_API_KEY is not set");
      },
      charge: vi.fn(async () => ({ allowed: true as const })),
    };
    await expect(resolveStopLocation({ name: "X" }, ctx, unconfigured)).resolves.toEqual({
      location: { name: "X" },
      outcome: "unavailable",
    });
  });
});

// The Finger Lakes trip (2026-10-03): correct New York pins stored with
// `countryCode: "JP"`, so every card read "Ithaca, Japan". The pins here are
// real, so the offline borders (`countryAtPoint`) answer for them as they would
// in production; only LocationIQ is stubbed.
describe("resolveStopLocation: a stop's country is the country at its own pin", () => {
  const DEEP_DIVE = { name: "Deep Dive", lat: 42.443083, lng: -76.512429, city: "Ithaca", countryCode: "JP" };
  const ITHACA = { lat: 42.4431, lng: -76.5124, canonicalName: "Deep Dive, Ithaca, New York, USA", countryCode: "US", city: "Ithaca" };
  // Mid-Atlantic, past every coastal water the offline borders reach.
  const AT_SEA = { name: "Ferry", lat: 40, lng: -40, countryCode: "PT" };
  // Japan is already on the trip: what the trip holds must not excuse a wrong country.
  const trip = { userId: "u1", region: null, countries: ["JP", "US"] };

  it("a country the point is not in is replaced by the point's own, even one the trip already holds", async () => {
    const d = deps({ reverse: vi.fn(async () => ITHACA) });
    const r = await resolveStopLocation(DEEP_DIVE, trip, d);
    expect(r).toEqual({ location: { ...DEEP_DIVE, countryCode: "US" }, outcome: "provided" });
    expect(d.g.reverse).toHaveBeenCalledWith({ lat: 42.443083, lng: -76.512429 });
    expect(d.charge).toHaveBeenCalledWith("u1");
  });

  // The allowance this module protects: a write whose country is already right,
  // or that sent none, costs no LocationIQ lookup.
  it("a country the point is in, or none at all, is settled offline and spends nothing", async () => {
    const d = deps({ reverse: vi.fn(async () => ITHACA) });
    const right = { ...DEEP_DIVE, countryCode: "US" };
    expect((await resolveStopLocation(right, trip, d)).location).toEqual(right);

    const bare = { name: DEEP_DIVE.name, lat: DEEP_DIVE.lat, lng: DEEP_DIVE.lng, city: DEEP_DIVE.city };
    expect((await resolveStopLocation(bare, trip, d)).location).toEqual({ ...bare, countryCode: "US" });

    expect(d.g.reverse).not.toHaveBeenCalled();
    expect(d.charge).not.toHaveBeenCalled();
  });

  // The bundled borders are simplified, so on a disagreement the vendor decides,
  // and may side with the caller (a pin a few metres over a border).
  it("on a disagreement LocationIQ decides, and can keep the caller's country", async () => {
    const claimed = { ...DEEP_DIVE, countryCode: "CA" };
    const d = deps({ reverse: vi.fn(async () => ({ ...ITHACA, countryCode: "CA" })) });
    expect((await resolveStopLocation(claimed, trip, d)).location).toEqual(claimed);
    expect(d.g.reverse).toHaveBeenCalledTimes(1);
  });

  it("an address's country is the caller's text and is never checked", async () => {
    const d = deps({ reverse: vi.fn(async () => ITHACA) });
    const input = { ...DEEP_DIVE, address: { countryCode: "JP" as const, lines: ["1-2-3 Nishi-Azabu"] } };
    const r = await resolveStopLocation(input, trip, d);
    expect(r.location).toEqual(input);
    expect(d.g.reverse).not.toHaveBeenCalled();
    expect(d.charge).not.toHaveBeenCalled();
  });

  it("when LocationIQ can't answer a disagreement, the offline country wins over the caller's", async () => {
    const refused = deps({ reverse: vi.fn(async () => ITHACA) }, { allowed: false, reason: "user", retryAfterSeconds: 60 });
    expect((await resolveStopLocation(DEEP_DIVE, trip, refused)).location.countryCode).toBe("US");
    expect(refused.g.reverse).not.toHaveBeenCalled();

    const failing = deps({
      reverse: vi.fn(async () => {
        throw new Error("reverse geocode failed: 500");
      }),
    });
    expect((await resolveStopLocation(DEEP_DIVE, trip, failing)).location.countryCode).toBe("US");

    const noReverse = deps();
    expect((await resolveStopLocation(DEEP_DIVE, trip, noReverse)).location.countryCode).toBe("US");
    expect(noReverse.charge).not.toHaveBeenCalled();
  });

  it("a pin outside every bundled border asks LocationIQ, and keeps the caller's country when it can't say", async () => {
    const answered = deps({ reverse: vi.fn(async () => ({ ...ITHACA, countryCode: "CV" })) });
    expect((await resolveStopLocation(AT_SEA, trip, answered)).location.countryCode).toBe("CV");
    expect(answered.charge).toHaveBeenCalledWith("u1");

    const sea = deps({ reverse: vi.fn(async () => null) });
    expect(await resolveStopLocation(AT_SEA, trip, sea)).toEqual({ location: AT_SEA, outcome: "provided" });
    const refused = deps({ reverse: vi.fn(async () => ITHACA) }, { allowed: false, reason: "global", retryAfterSeconds: 60 });
    expect((await resolveStopLocation(AT_SEA, trip, refused)).location).toEqual(AT_SEA);
  });
});

// KI-2026-11-03. A name lookup's answer used to be stored unchecked, and Ria's
// Wines, on a Finger Lakes trip, was pinned in Atlanta. It is judged now by the
// assistant's rule (`placeAcceptance.ts`): inside the trip's region unless the
// caller named the country, and never under a different place's name.
describe("a name lookup's answer is judged before it is stored (KI-2026-11-03)", () => {
  const FINGER_LAKES = { minLat: 42, maxLat: 43.5, minLng: -79.5, maxLng: -76.5 };
  const trip = { userId: "u1", region: FINGER_LAKES, countries: ["US"] };
  const ATLANTA = { lat: 33.749, lng: -84.388, canonicalName: "Ria's Wines, Peachtree Street, Atlanta, Georgia, USA", countryCode: "US" };
  const PENN_YAN = { lat: 42.6609, lng: -77.0539, canonicalName: "Penn Yan, Yates County, New York, USA", countryCode: "US" };

  function lookups(answers: Record<string, object[]>) {
    return deps({ forward: vi.fn(async (query: string) => answers[query] ?? []) as Geocoder["forward"] });
  }

  it("refuses the right name in the wrong state, and saves the stop without coordinates", async () => {
    const d = lookups({ "Ria's Wines": [ATLANTA] });
    const r = await resolveStopLocation({ name: "Ria's Wines" }, trip, d);
    expect(r).toEqual({ location: { name: "Ria's Wines" }, outcome: "rejected" });
  });

  it("refuses a different venue inside the trip's region", async () => {
    const d = lookups({ "Ria's Wines": [{ ...PENN_YAN, canonicalName: "Liquor Outlet, Main Street, Penn Yan, New York, USA" }] });
    const r = await resolveStopLocation({ name: "Ria's Wines" }, trip, d);
    expect(r.outcome).toBe("rejected");
    expect(r.location.lat).toBeUndefined();
  });

  it("refuses the wrong state even when the caller named the trip's own country", async () => {
    const d = lookups({ "Ria's Wines": [ATLANTA] });
    const r = await resolveStopLocation({ name: "Ria's Wines", countryCode: "US" }, trip, d);
    expect(r.outcome).toBe("rejected");
  });

  it("pins a refused stop at its city's centre when it names a city and a country", async () => {
    const d = lookups({ "Ria's Wines": [ATLANTA], "Penn Yan, US": [PENN_YAN] });
    const input = { name: "Ria's Wines", city: "Penn Yan", countryCode: "US" };
    const r = await resolveStopLocation(input, trip, d);
    expect(r).toEqual({
      location: { ...input, lat: PENN_YAN.lat, lng: PENN_YAN.lng, precision: "city" },
      outcome: "city",
    });
    expect(Location.safeParse(r.location).success).toBe(true);
  });

  it("charges the city lookup like the venue lookup", async () => {
    const d = lookups({ "Ria's Wines": [ATLANTA], "Penn Yan, US": [PENN_YAN] });
    await resolveStopLocation({ name: "Ria's Wines", city: "Penn Yan", countryCode: "US" }, trip, d);
    expect(d.charge).toHaveBeenCalledTimes(2);
  });

  // The first stop in a new country still resolves by name when the caller
  // says which country (docs/guidelines/using-the-api.md): the country filter is
  // the geographic check, and it is never widened.
  it("takes an answer outside the trip's region when the caller named its country and its name agrees", async () => {
    const SEOUL = { lat: 37.5665, lng: 126.978, canonicalName: "Gwangjang Market, Jongno-gu, Seoul, South Korea", countryCode: "KR" };
    const d = lookups({ "Gwangjang Market": [SEOUL] });
    const r = await resolveStopLocation({ name: "Gwangjang Market", countryCode: "KR" }, trip, d);
    expect(r.outcome).toBe("name");
    expect(r.location).toMatchObject({ lat: SEOUL.lat, lng: SEOUL.lng });
  });

  // Review of PR 686, finding 1: a leg's far end puts its country in
  // `countries`, but the region is drawn around `location`s only, so that
  // country is still new to the region.
  it("treats a country the trip reaches only by a leg's far end as new to the region", async () => {
    const SEOUL = { lat: 37.5665, lng: 126.978, canonicalName: "Gwangjang Market, Jongno-gu, Seoul, South Korea", countryCode: "KR" };
    const TOKYO = { minLat: 34.5, maxLat: 36.5, minLng: 138.5, maxLng: 140.5 };
    const japan = { userId: "u1", region: TOKYO, countries: ["JP", "KR"], regionCountries: ["JP"] };
    const r = await resolveStopLocation({ name: "Gwangjang Market", countryCode: "KR" }, japan, lookups({ "Gwangjang Market": [SEOUL] }));
    expect(r.outcome).toBe("name");
  });

  // Review of PR 686, finding 2: the city answer faces the same region as the
  // venue answer did. Mitchell, 2026-11-03: a city the caller NAMED loosens
  // it, so only an answer that is not that city is refused outside the region.
  it("refuses a city answer outside the trip's region unless it is the city the caller named", async () => {
    const PHILADELPHIA = { lat: 39.9526, lng: -75.1652, canonicalName: "Philadelphia, Pennsylvania, USA", countryCode: "US", city: "Philadelphia" };
    const other = lookups({ "Ria's Wines": [ATLANTA], "Penn Yan, US": [PHILADELPHIA] });
    const refused = await resolveStopLocation({ name: "Ria's Wines", city: "Penn Yan", countryCode: "US" }, trip, other);
    expect(refused).toEqual({ location: { name: "Ria's Wines", city: "Penn Yan", countryCode: "US" }, outcome: "rejected" });

    // What the loosening admits, knowingly: the caller named Springfield.
    const SPRINGFIELD_IL = { lat: 39.7817, lng: -89.6501, canonicalName: "Springfield, Sangamon County, Illinois, USA", countryCode: "US" };
    const named = lookups({ "Ria's Wines": [ATLANTA], "Springfield, US": [SPRINGFIELD_IL] });
    const pinned = await resolveStopLocation({ name: "Ria's Wines", city: "Springfield", countryCode: "US" }, trip, named);
    expect(pinned).toMatchObject({ outcome: "city", location: { lat: SPRINGFIELD_IL.lat, precision: "city" } });
  });

  // Mitchell, 2026-11-03: naming the city is how a stop far from the rest of
  // the trip, in a country it is already in, resolves by name.
  it("takes a venue outside the trip's region when it is in the city the caller named", async () => {
    const NYC = { minLat: 40.4, maxLat: 41, minLng: -74.3, maxLng: -73.6 };
    const nyTrip = { userId: "u1", region: NYC, countries: ["US"], regionCountries: ["US"] };
    const NEPTUNE = { lat: 42.3601, lng: -71.0549, canonicalName: "Neptune Oyster, Salem Street, Boston, Massachusetts, USA", countryCode: "US", city: "Boston" };

    const inBoston = await resolveStopLocation({ name: "Neptune Oyster", city: "Boston", countryCode: "US" }, nyTrip, lookups({ "Neptune Oyster": [NEPTUNE] }));
    expect(inBoston.outcome).toBe("name");
    expect(inBoston.location).toMatchObject({ lat: NEPTUNE.lat, city: "Boston" });

    // No city named, or a different one: the region still refuses it.
    const unnamed = await resolveStopLocation({ name: "Neptune Oyster", countryCode: "US" }, nyTrip, lookups({ "Neptune Oyster": [NEPTUNE] }));
    expect(unnamed.outcome).toBe("rejected");
    const elsewhere = lookups({ "Neptune Oyster": [NEPTUNE] });
    const otherCity = await resolveStopLocation({ name: "Neptune Oyster", city: "Cambridge", countryCode: "US" }, nyTrip, elsewhere);
    expect(otherCity.location.precision).not.toBe("venue");
    expect(otherCity.outcome).not.toBe("name");

    // The vendor's `city` is not always the one people name: a Brooklyn
    // venue's is "New York", and "Brooklyn" is a part of its label.
    const PETER_LUGER = { lat: 40.7099, lng: -73.9623, canonicalName: "Peter Luger, Broadway, Brooklyn, New York, USA", countryCode: "US", city: "New York", area: "Brooklyn" };
    const bostonTrip = { userId: "u1", region: { minLat: 42, maxLat: 42.7, minLng: -71.5, maxLng: -70.7 }, countries: ["US"], regionCountries: ["US"] };
    const brooklyn = await resolveStopLocation({ name: "Peter Luger", city: "Brooklyn", countryCode: "US" }, bostonTrip, lookups({ "Peter Luger": [PETER_LUGER] }));
    expect(brooklyn.outcome).toBe("name");

    // A STATE that shares the named city's name is not that city: Buffalo's
    // Anchor Bar is in New York State, and a NYC trip naming "New York" must
    // not take it (third review of PR 686).
    const ANCHOR_BAR = { lat: 42.9006, lng: -78.8707, canonicalName: "Anchor Bar, Main Street, Buffalo, Erie County, New York, 14209, United States", countryCode: "US", city: "Buffalo" };
    const buffalo = await resolveStopLocation({ name: "Anchor Bar", city: "New York", countryCode: "US" }, nyTrip, lookups({ "Anchor Bar": [ANCHOR_BAR] }));
    expect(buffalo.outcome).not.toBe("name");
    expect(buffalo.location.lat).not.toBe(ANCHOR_BAR.lat);

    // And never the name check: a different restaurant in Boston is refused.
    const wrongName = { ...NEPTUNE, canonicalName: "Legal Sea Foods, Boston, Massachusetts, USA" };
    const r = await resolveStopLocation({ name: "Neptune Oyster", city: "Boston" }, nyTrip, lookups({ "Neptune Oyster": [wrongName] }));
    expect(r.outcome).toBe("rejected");
  });

  it("reports rejected, with no second lookup, when the city fallback cannot run", async () => {
    const noCity = lookups({ "Ria's Wines": [ATLANTA] });
    expect((await resolveStopLocation({ name: "Ria's Wines", countryCode: "US" }, trip, noCity)).outcome).toBe("rejected");
    expect(noCity.charge).toHaveBeenCalledTimes(1);

    // The venue lookup was paid for; the city's charge is refused.
    const d = lookups({ "Ria's Wines": [ATLANTA], "Penn Yan, US": [PENN_YAN] });
    vi.mocked(d.charge).mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false, reason: "user", retryAfterSeconds: 60 });
    const spent = await resolveStopLocation({ name: "Ria's Wines", city: "Penn Yan", countryCode: "US" }, trip, d);
    expect(spent.outcome).toBe("rejected");
    expect(d.g.forward).toHaveBeenCalledTimes(1);

    // The city lookup itself throwing: still rejected, never an exception.
    const throwing = deps({
      forward: vi.fn(async (query: string) => {
        if (query === "Ria's Wines") return [ATLANTA];
        throw new Error("geocode failed: 500");
      }) as Geocoder["forward"],
    });
    const failed = await resolveStopLocation({ name: "Ria's Wines", city: "Penn Yan", countryCode: "US" }, trip, throwing);
    expect(failed).toEqual({ location: { name: "Ria's Wines", city: "Penn Yan", countryCode: "US" }, outcome: "rejected" });
  });

  it("refuses a wrong-named leg destination, region or not", async () => {
    const JFK = { lat: 40.6413, lng: -73.7781, canonicalName: "LaGuardia Airport, Queens, New York, USA", countryCode: "US" };
    const headers = new Headers();
    const leg = await resolveStopPlaces(
      { location: { name: "Penn Yan", lat: 42.66, lng: -77.05 }, endLocation: { name: "John F. Kennedy International Airport" } },
      trip,
      headers,
      lookups({ "John F. Kennedy International Airport": [JFK] }),
    );
    expect(headers.get("Geocode-Outcome-End")).toBe("rejected");
    expect((leg.endLocation as Location | undefined)?.lat).toBeUndefined();
  });

  it("judges a travel leg's destination without the trip's region", async () => {
    const BUFFALO = { lat: 42.94, lng: -78.73, canonicalName: "Buffalo Niagara International Airport, Cheektowaga, New York, USA", countryCode: "US" };
    const JFK = { lat: 40.6413, lng: -73.7781, canonicalName: "John F. Kennedy International Airport, Queens, New York, USA", countryCode: "US" };
    const d = lookups({ "Buffalo Niagara International Airport": [BUFFALO], "John F. Kennedy International Airport": [JFK] });
    const headers = new Headers();
    const leg = await resolveStopPlaces(
      { location: { name: "Buffalo Niagara International Airport" }, endLocation: { name: "John F. Kennedy International Airport" } },
      trip,
      headers,
      d,
    );
    expect(headers.get("Geocode-Outcome")).toBe("name");
    expect(headers.get("Geocode-Outcome-End")).toBe("name");
    expect(leg.endLocation).toMatchObject({ lat: JFK.lat });
  });
});
