import { describe, expect, it, vi } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import type { GeocodeResult, Geocoder } from "@/server/geocoding";
import { enrichCommandLocations, hasUnverifiedLocations, type LocationEnrichmentReport } from "./geocodeEnrichment";

const TRIP = "11111111-1111-4111-8111-111111111111";

function addActivity(
  title: string,
  location?: { name: string; lat?: number; lng?: number },
): BatchableCommand {
  return {
    type: "AddActivity",
    tripId: TRIP,
    activityId: "22222222-2222-4222-8222-222222222222",
    title,
    ...(location ? { location } : {}),
  } as BatchableCommand;
}

// A geocoder whose answers are looked up by query string; anything not in the
// map returns no results. `calls` records every query for throttle assertions.
function fakeGeocoder(answers: Record<string, GeocodeResult[] | Error>) {
  const calls: string[] = [];
  const geocoder: Geocoder = {
    async forward(query) {
      calls.push(query);
      const answer = answers[query];
      if (answer instanceof Error) throw answer;
      return answer ?? [];
    },
  };
  return { geocoder, calls };
}

const NIAGARA = { lat: 43.0866, lng: -79.0628 };

describe("enrichCommandLocations", () => {
  it("leaves a batch with no locations completely alone and never builds a geocoder", async () => {
    const getGeocoder = vi.fn(() => { throw new Error("must not construct"); });
    const commands = [addActivity("Rest day")];
    const { commands: out, report } = await enrichCommandLocations(commands, getGeocoder);
    expect(out).toEqual(commands);
    expect(getGeocoder).not.toHaveBeenCalled();
    expect(report).toEqual({ verified: [], unverified: [], unchecked: [], failed: [], skipped: [] });
  });

  // No hint and no trip region: the answer is taken, but reported `unchecked`
  // rather than `verified` — we had nothing to check it against.
  it("fills in coordinates when the model supplied none, reporting them unchecked", async () => {
    const { geocoder } = fakeGeocoder({
      "Niagara Falls State Park": [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Falls", { name: "Niagara Falls State Park" })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({
      location: {
        name: "Niagara Falls State Park, NY, USA",
        lat: 43.0866,
        lng: -79.0628,
        countryCode: "US",
      },
    });
    expect(report.unchecked).toEqual(["Niagara Falls State Park"]);
    expect(report.verified).toEqual([]);
  });

  // KI-15's headline failure, verbatim: the model had the RIGHT coordinates and
  // enrichment replaced them with a coaching inn 5,500 km away.
  it("rejects a match that contradicts the model's plausible coordinates", async () => {
    const { geocoder } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 52.907918, lng: -2.8901, canonicalName: "The Red Lion Coaching Inn, Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn", ...NIAGARA })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({
      location: { name: "The Red Coach Inn", lat: NIAGARA.lat, lng: NIAGARA.lng },
    });
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
    expect(report.verified).toEqual([]);
  });

  it("accepts a match that refines the model's coordinates within the same metro", async () => {
    const { geocoder } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 43.0812, lng: -79.0665, canonicalName: "The Red Coach Inn, Niagara Falls, NY, USA", countryCode: "US" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn", ...NIAGARA })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({
      location: { name: "The Red Coach Inn, Niagara Falls, NY, USA", lat: 43.0812, lng: -79.0665 },
    });
    expect(report.verified).toEqual(["The Red Coach Inn"]);
  });

  it("treats lat 0/lng 0 as no coordinates, not as a hint", async () => {
    const { geocoder } = fakeGeocoder({
      "Strong Museum of Play": [
        { lat: 43.1548, lng: -77.695, canonicalName: "The Strong, Rochester, NY, USA", countryCode: "US" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Museum", { name: "Strong Museum of Play", lat: 0, lng: 0 })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({ location: { lat: 43.1548, lng: -77.695 } });
    // Accepted, but unchecked — 0,0 is not a hint, and there is no trip region.
    expect(report.unchecked).toEqual(["Strong Museum of Play"]);
  });

  // Mitchell's pre-flight decision: lookups are sequential, so the first
  // accepted coordinate tells the batch where the trip is. Without this, every
  // location on a freshly planned trip would be unchecked.
  it("bootstraps a region from accepted results and checks later lookups against it", async () => {
    const { geocoder } = fakeGeocoder({
      "Niagara Falls State Park": [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
      "The Red Coach Inn": [
        { lat: 52.907918, lng: -2.8901, canonicalName: "The Red Lion Coaching Inn, Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [
        addActivity("Falls", { name: "Niagara Falls State Park" }),
        addActivity("Dinner", { name: "The Red Coach Inn" }),
      ],
      () => geocoder,
      null,
      async () => {},
    );

    // First lookup: nothing to check against, so accepted as unchecked.
    expect(report.unchecked).toEqual(["Niagara Falls State Park"]);
    // Second: now checked against a region seeded by the first — and rejected,
    // even though the model gave no hint of its own.
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
    expect(commands[1]).toMatchObject({ location: { name: "The Red Coach Inn" } });
    expect((commands[1] as { location: { lat?: number } }).location.lat).toBeUndefined();
  });

  it("accepts a later lookup that falls inside the bootstrapped region", async () => {
    const { geocoder } = fakeGeocoder({
      "Niagara Falls State Park": [
        { lat: 43.0866, lng: -79.0628, canonicalName: "Niagara Falls State Park, NY, USA", countryCode: "US" },
      ],
      "Strong Museum of Play": [
        { lat: 43.1548, lng: -77.695, canonicalName: "The Strong, Rochester, NY, USA", countryCode: "US" },
      ],
    });
    const { report } = await enrichCommandLocations(
      [
        addActivity("Falls", { name: "Niagara Falls State Park" }),
        addActivity("Museum", { name: "Strong Museum of Play" }),
      ],
      () => geocoder,
      null,
      async () => {},
    );
    expect(report.unchecked).toEqual(["Niagara Falls State Park"]);
    expect(report.verified).toEqual(["Strong Museum of Play"]);
  });

  it("rejects a match outside the trip region when the model gave no hint", async () => {
    const { geocoder } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 52.907918, lng: -2.8901, canonicalName: "Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn" })],
      () => geocoder,
      { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    );
    expect(commands[0]).toMatchObject({ location: { name: "The Red Coach Inn" } });
    expect((commands[0] as { location: { lat?: number } }).location.lat).toBeUndefined();
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
  });

  it("biases the query with a viewbox drawn from the trip region", async () => {
    const forward = vi.fn(async () => []);
    await enrichCommandLocations(
      [addActivity("Dinner", { name: "Somewhere" })],
      () => ({ forward }),
      { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    );
    expect(forward).toHaveBeenCalledWith("Somewhere", {
      limit: 1,
      viewbox: { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 },
    });
  });

  it("reports a thrown lookup as failed and keeps the model's location", async () => {
    const { geocoder } = fakeGeocoder({ "Rate Limited Place": new Error("geocode failed: 429") });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Lunch", { name: "Rate Limited Place", ...NIAGARA })],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({ location: { name: "Rate Limited Place", ...NIAGARA } });
    expect(report.failed).toEqual(["Rate Limited Place"]);
  });

  it("reports an empty match as unverified", async () => {
    const { geocoder } = fakeGeocoder({});
    const { report } = await enrichCommandLocations(
      [addActivity("Lunch", { name: "Nowhere At All" })],
      () => geocoder,
    );
    expect(report.unverified).toEqual(["Nowhere At All"]);
  });

  it("never lets a geocoder failure reject the whole batch", async () => {
    const geocoder: Geocoder = { async forward() { throw new Error("vendor down"); } };
    await expect(
      enrichCommandLocations([addActivity("Lunch", { name: "X" })], () => geocoder),
    ).resolves.toBeDefined();
  });

  // Bug 1 (final whole-branch review): a model hint was previously checked
  // against ONLY itself, never against an available trip region — so a wrong
  // hint that happened to sit near the geocoder's top match got reported
  // `verified`, and that persisted, region-widening "verified" location would
  // have permanently and silently grown the trip's region on every later
  // request. Acceptance must agree with every belief in play, not just the
  // strongest one.
  it("rejects a hint that disagrees with the trip region, even when the geocoder's match agrees with the hint", async () => {
    const region = { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 }; // a Niagara-area trip
    const wrongHint = { lat: 52.907918, lng: -2.8901 }; // Shropshire — nowhere near the trip
    const { geocoder, calls } = fakeGeocoder({
      "The Red Coach Inn": [
        { lat: 52.9081, lng: -2.8905, canonicalName: "The Red Lion Coaching Inn, Shropshire, England", countryCode: "GB" },
      ],
    });
    const { commands, report } = await enrichCommandLocations(
      [addActivity("Dinner", { name: "The Red Coach Inn", ...wrongHint })],
      () => geocoder,
      region,
    );
    expect(calls).toEqual(["The Red Coach Inn"]);
    expect(report.verified).toEqual([]);
    expect(report.unverified).toEqual(["The Red Coach Inn"]);
    // Never relocated: the model's own (wrong) hint survives as the fallback
    // — not the geocoder's Shropshire match, and not silently dropped either.
    expect(commands[0]).toMatchObject({
      location: { name: "The Red Coach Inn", lat: wrongHint.lat, lng: wrongHint.lng },
    });
  });

  // Companion to the above: a disagreeing hint must not even get to define
  // its own private viewbox. If it did, the geocoder search itself would be
  // scoped tightly around the wrong hint, making a "the match agrees with
  // the hint" result almost inevitable regardless of the region.
  it("scopes the geocoder search to the trip region, not a disagreeing hint's own viewbox", async () => {
    const forward = vi.fn(async () => []);
    const region = { minLat: 42, maxLat: 44, minLng: -80, maxLng: -77 };
    await enrichCommandLocations(
      [addActivity("Dinner", { name: "Somewhere", lat: 52.9, lng: -2.89 })],
      () => ({ forward }),
      region,
    );
    expect(forward).toHaveBeenCalledWith("Somewhere", { limit: 1, viewbox: region });
  });

  // Bug 2 (final whole-branch review): dedupe-by-name kept only the FIRST
  // command's hint, then stamped the ONE resolved location onto every command
  // sharing that normalized name — including the fallback location for
  // commands whose own hint disagreed. Two commands can legitimately share a
  // display name while the model gave them genuinely different coordinates;
  // the fallback path must rebuild from each command's OWN location, not
  // reuse whichever command happened to be seen first.
  it("keeps each command's own coordinates when a shared name's lookup falls back to unverified", async () => {
    const { geocoder, calls } = fakeGeocoder({ "Lunch in Rochester, NY": [] }); // no match at all
    const HINT_A = { lat: 43.1566, lng: -77.6088 };
    const HINT_B = { lat: 41.2033, lng: -77.1945 }; // different, still-plausible coordinates
    const { commands } = await enrichCommandLocations(
      [
        addActivity("Day 1 lunch", { name: "Lunch in Rochester, NY", ...HINT_A }),
        addActivity("Day 2 lunch", { name: "Lunch in Rochester, NY", ...HINT_B }),
      ],
      () => geocoder,
    );
    expect(calls).toEqual(["Lunch in Rochester, NY"]); // dedupe still makes one lookup
    expect(commands[0]).toMatchObject({ location: { name: "Lunch in Rochester, NY", ...HINT_A } });
    expect(commands[1]).toMatchObject({ location: { name: "Lunch in Rochester, NY", ...HINT_B } });
  });

  // Same bug, via the `failed` outcome (thrown lookup) rather than `unverified`.
  it("keeps each command's own coordinates when a shared name's lookup fails", async () => {
    const { geocoder } = fakeGeocoder({ "Lunch in Rochester, NY": new Error("geocode failed: 429") });
    const HINT_A = { lat: 43.1566, lng: -77.6088 };
    const HINT_B = { lat: 41.2033, lng: -77.1945 };
    const { commands } = await enrichCommandLocations(
      [
        addActivity("Day 1 lunch", { name: "Lunch in Rochester, NY", ...HINT_A }),
        addActivity("Day 2 lunch", { name: "Lunch in Rochester, NY", ...HINT_B }),
      ],
      () => geocoder,
    );
    expect(commands[0]).toMatchObject({ location: { name: "Lunch in Rochester, NY", ...HINT_A } });
    expect(commands[1]).toMatchObject({ location: { name: "Lunch in Rochester, NY", ...HINT_B } });
  });

  it("dedupes repeated names to a single lookup and applies it everywhere", async () => {
    const { geocoder, calls } = fakeGeocoder({
      "Lunch in Rochester, NY": [
        { lat: 43.1566, lng: -77.6088, canonicalName: "Rochester, NY, USA", countryCode: "US" },
      ],
    });
    const { commands } = await enrichCommandLocations(
      [
        addActivity("Day 1 lunch", { name: "Lunch in Rochester, NY" }),
        addActivity("Day 2 lunch", { name: "lunch in rochester, ny  " }),
      ],
      () => geocoder,
    );
    expect(calls).toEqual(["Lunch in Rochester, NY"]);
    expect(commands[0]).toMatchObject({ location: { lat: 43.1566 } });
    expect(commands[1]).toMatchObject({ location: { lat: 43.1566 } });
  });

  it("runs lookups sequentially, never concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const geocoder: Geocoder = {
      async forward() {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return [];
      },
    };
    await enrichCommandLocations(
      ["a", "b", "c", "d"].map((n) => addActivity(n, { name: `place ${n}` })),
      () => geocoder,
      null,
      async () => {},
    );
    expect(maxInFlight).toBe(1);
  });

  it("caps lookups per batch and reports the remainder as skipped", async () => {
    const { geocoder, calls } = fakeGeocoder({});
    const commands = Array.from({ length: 20 }, (_, i) => addActivity(`a${i}`, { name: `place ${i}` }));
    const { report } = await enrichCommandLocations(commands, () => geocoder, null, async () => {});
    expect(calls.length).toBe(15);
    expect(report.skipped.length).toBe(5);
    expect(report.skipped[0]).toBe("place 15");
  });

  it("ignores a cleared location (null) on UpdateActivity", async () => {
    const getGeocoder = vi.fn(() => { throw new Error("must not construct"); });
    const command = {
      type: "UpdateActivity",
      tripId: TRIP,
      activityId: "22222222-2222-4222-8222-222222222222",
      location: null,
    } as unknown as BatchableCommand;
    const { commands, report } = await enrichCommandLocations([command], getGeocoder);
    expect(commands).toEqual([command]);
    expect(getGeocoder).not.toHaveBeenCalled();
    expect(report.verified).toEqual([]);
  });
});

describe("hasUnverifiedLocations", () => {
  const emptyReport = (): LocationEnrichmentReport => ({
    verified: [],
    unverified: [],
    unchecked: [],
    failed: [],
    skipped: [],
  });

  it("is false for entries only in unchecked", () => {
    const report = { ...emptyReport(), unchecked: ["Niagara Falls State Park"] };
    expect(hasUnverifiedLocations(report)).toBe(false);
  });

  it("is true for entries only in unverified", () => {
    const report = { ...emptyReport(), unverified: ["The Red Coach Inn"] };
    expect(hasUnverifiedLocations(report)).toBe(true);
  });

  it("is true for entries only in failed", () => {
    const report = { ...emptyReport(), failed: ["Rate Limited Place"] };
    expect(hasUnverifiedLocations(report)).toBe(true);
  });

  it("is true for entries only in skipped", () => {
    const report = { ...emptyReport(), skipped: ["place 15"] };
    expect(hasUnverifiedLocations(report)).toBe(true);
  });

  it("is false for an all-empty report", () => {
    expect(hasUnverifiedLocations(emptyReport())).toBe(false);
  });
});
