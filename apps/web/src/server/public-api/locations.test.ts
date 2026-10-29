import { describe, expect, it, vi } from "vitest";
import { Location } from "@tc/contracts";
import type { Geocoder } from "@/server/geocoding";
import type { QuotaDecision } from "@/server/quota";
import { resolveStopLocation, type ResolveDeps } from "./locations";

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
    const d = deps();
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
    const d = deps();
    const r = await resolveStopLocation({ name: "Dinner", city: "Heidelberg-Handschuhsheim", area: "Neuenheim" }, ctx, d);
    expect(r.location).toEqual({ name: "Dinner", city: "Heidelberg-Handschuhsheim", area: "Neuenheim", lat: 49.41, lng: 8.69, countryCode: "DE" });
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
// `countryCode: "JP"`, so every card read "Ithaca, Japan".
describe("resolveStopLocation: a stop's country is the country at its own pin", () => {
  const DEEP_DIVE = { name: "Deep Dive", lat: 42.443083, lng: -76.512429, city: "Ithaca", countryCode: "JP" };
  const ITHACA = { lat: 42.4431, lng: -76.5124, canonicalName: "Deep Dive, Ithaca, New York, USA", countryCode: "US", city: "Ithaca" };
  // Japan is already on the trip: what the trip holds must not excuse a wrong country.
  const trip = { userId: "u1", region: null, countries: ["JP", "US"] };

  it("a country the point is not in is replaced by the point's own, even one the trip already holds", async () => {
    const d = deps({ reverse: vi.fn(async () => ITHACA) });
    const r = await resolveStopLocation(DEEP_DIVE, trip, d);
    expect(r).toEqual({ location: { ...DEEP_DIVE, countryCode: "US" }, outcome: "provided" });
    expect(d.g.reverse).toHaveBeenCalledWith({ lat: 42.443083, lng: -76.512429 });
    expect(d.charge).toHaveBeenCalledWith("u1");
  });

  it("a pin sent with no country gets the point's country", async () => {
    const d = deps({ reverse: vi.fn(async () => ITHACA) });
    const bare = { name: DEEP_DIVE.name, lat: DEEP_DIVE.lat, lng: DEEP_DIVE.lng, city: DEEP_DIVE.city };
    const r = await resolveStopLocation(bare, trip, d);
    expect(r.location).toEqual({ ...bare, countryCode: "US" });
  });

  it("a country the point really is in is kept as sent", async () => {
    const niagara = { name: "Table Rock", lat: 43.0794, lng: -79.0782, countryCode: "CA" };
    const d = deps({ reverse: vi.fn(async () => ({ ...ITHACA, countryCode: "CA" })) });
    const r = await resolveStopLocation(niagara, { ...trip, countries: ["US"] }, d);
    expect(r.location).toEqual(niagara);
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

  it("no quota, a vendor failure, no reverse, or nothing at the point: what the caller sent stands", async () => {
    const refused = deps({ reverse: vi.fn(async () => ITHACA) }, { allowed: false, reason: "user", retryAfterSeconds: 60 });
    expect((await resolveStopLocation(DEEP_DIVE, trip, refused)).location.countryCode).toBe("JP");
    expect(refused.g.reverse).not.toHaveBeenCalled();

    const failing = deps({
      reverse: vi.fn(async () => {
        throw new Error("reverse geocode failed: 500");
      }),
    });
    expect(await resolveStopLocation(DEEP_DIVE, trip, failing)).toEqual({ location: DEEP_DIVE, outcome: "provided" });

    const noReverse = deps();
    expect((await resolveStopLocation(DEEP_DIVE, trip, noReverse)).location.countryCode).toBe("JP");
    expect(noReverse.charge).not.toHaveBeenCalled();
    const sea = deps({ reverse: vi.fn(async () => null) });
    expect((await resolveStopLocation(DEEP_DIVE, trip, sea)).location.countryCode).toBe("JP");
  });
});
