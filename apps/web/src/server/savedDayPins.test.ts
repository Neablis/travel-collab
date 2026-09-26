import { describe, expect, it } from "vitest";
import type { Location, SavedStop } from "@tc/contracts";
import type { GeocodeResult, Geocoder } from "@/server/geocoding";
import { MIN_INTERVAL_MS } from "@/server/ai/rateLimit";
import { hasUnpinnedStops, MAX_PIN_LOOKUPS_PER_READ, pinStops } from "./savedDayPins";

// The rules `savedDayPins.ts` states, each against a stub vendor — the stops of
// Mitchell's "M23 three-day walk" look exactly like `stop()` below: a name and a
// city, and no coordinate.

const KYOTO = { lat: 35.0116, lng: 135.7681 };
const FUSHIMI = { lat: 34.9671, lng: 135.7727 };

function stop(name: string, location: Partial<Location> = {}): SavedStop {
  return {
    title: name,
    timeWindow: null,
    location: { name, city: "Kyoto", ...location },
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    dayIndex: 0,
    mode: null,
    endLocation: null,
    pendingReason: null,
  };
}

function hit(at: { lat: number; lng: number }, canonicalName: string, over: Partial<GeocodeResult> = {}): GeocodeResult[] {
  return [{ ...at, canonicalName, ...over }];
}

/** Answers by exact query; anything else comes back empty. Records every query. */
function vendor(answers: Record<string, GeocodeResult[] | Error>) {
  const calls: string[] = [];
  const geocoder: Geocoder = {
    async forward(query) {
      calls.push(query);
      const answer = answers[query];
      if (answer instanceof Error) throw answer;
      return answer ?? [];
    },
    forwardAddress: async () => [],
  };
  return { geocoder, calls };
}

const free = async () => true;
const noSleep = async () => {};

describe("pinStops", () => {
  it("pins a corroborated venue, keeping the author's name and city", async () => {
    const { geocoder, calls } = vendor({
      Kyoto: hit(KYOTO, "Kyoto, Kyoto Prefecture, Japan"),
      "Fushimi Inari Taisha, Kyoto": hit(FUSHIMI, "Fushimi Inari Taisha, Fushimi, Kyoto", {
        countryCode: "JP",
        area: "Fushimi",
      }),
    });
    const { stops } = await pinStops([stop("Fushimi Inari Taisha")], { geocoder, charge: free, sleep: noSleep });
    expect(calls).toEqual(["Kyoto", "Fushimi Inari Taisha, Kyoto"]);
    expect(stops[0]!.location).toEqual({
      name: "Fushimi Inari Taisha",
      city: "Kyoto",
      ...FUSHIMI,
      precision: "venue",
      countryCode: "JP",
      area: "Fushimi",
    });
  });

  // KI-39's class: a different venue in the right city. The name verdict
  // refuses it, and the stop is still placed — somewhere in Kyoto, said so.
  it("pins at city level when the vendor answers with a different venue", async () => {
    const { geocoder } = vendor({
      Kyoto: hit(KYOTO, "Kyoto"),
      "Kegon Falls, Kyoto": hit(FUSHIMI, "Urami Falls, Nikko"),
    });
    const { stops } = await pinStops([stop("Kegon Falls")], { geocoder, charge: free, sleep: noSleep });
    expect(stops[0]!.location).toEqual({ name: "Kegon Falls", city: "Kyoto", ...KYOTO, precision: "city" });
  });

  it("pins at city level when the venue answer is outside the city", async () => {
    const { geocoder } = vendor({
      Kyoto: hit(KYOTO, "Kyoto"),
      "Nishiki Market, Kyoto": hit({ lat: 35.68, lng: 139.76 }, "Nishiki Market, Tokyo"),
    });
    const { stops } = await pinStops([stop("Nishiki Market")], { geocoder, charge: free, sleep: noSleep });
    expect(stops[0]!.location?.precision).toBe("city");
    expect(stops[0]!.location?.lat).toBe(KYOTO.lat);
  });

  it("looks a city's centre up once, and reuses one already stored on a city-level stop", async () => {
    const { geocoder, calls } = vendor({ Kyoto: hit(KYOTO, "Kyoto") });
    await pinStops([stop("A"), stop("B")], { geocoder, charge: free, sleep: noSleep });
    expect(calls).toEqual(["Kyoto", "A, Kyoto", "B, Kyoto"]);

    const again = vendor({});
    await pinStops([stop("A", { ...KYOTO, precision: "city" }), stop("B")], {
      geocoder: again.geocoder,
      charge: free,
      sleep: noSleep,
    });
    expect(again.calls).toEqual(["B, Kyoto"]);
  });

  it("never looks up a stop that already has a coordinate, or one with no city", async () => {
    const { geocoder, calls } = vendor({});
    const stops = [stop("Placed", FUSHIMI), stop("Nowhere", { city: undefined })];
    const out = await pinStops(stops, { geocoder, charge: free, sleep: noSleep });
    expect(calls).toEqual([]);
    expect(out.stops).toEqual(stops);
    expect(hasUnpinnedStops(stops)).toBe(false);
  });

  it("leaves a city the vendor cannot find, and its stops, alone", async () => {
    const { geocoder, calls } = vendor({});
    const { stops } = await pinStops([stop("A"), stop("B")], { geocoder, charge: free, sleep: noSleep });
    expect(calls).toEqual(["Kyoto"]);
    expect(stops.every((s) => s.location?.lat === undefined)).toBe(true);
  });

  it("leaves a stop unpinned when its lookup fails, so the next read can try again", async () => {
    const { geocoder } = vendor({ Kyoto: hit(KYOTO, "Kyoto"), "A, Kyoto": new Error("429") });
    const { stops } = await pinStops([stop("A")], { geocoder, charge: free, sleep: noSleep });
    expect(stops[0]!.location?.lat).toBeUndefined();
  });

  it("spends at most the cap in one pass, and a second pass finishes the rest", async () => {
    const many = Array.from({ length: 14 }, (_, i) => stop(`Stop ${i + 1}`));
    const first = vendor({ Kyoto: hit(KYOTO, "Kyoto") });
    const one = await pinStops(many, { geocoder: first.geocoder, charge: free, sleep: noSleep });
    expect(first.calls).toHaveLength(MAX_PIN_LOOKUPS_PER_READ);
    expect(one.lookups).toBe(MAX_PIN_LOOKUPS_PER_READ);
    // The centre plus eleven venues: eleven stops placed, three left for later.
    expect(one.stops.filter((s) => s.location?.lat !== undefined)).toHaveLength(MAX_PIN_LOOKUPS_PER_READ - 1);

    const second = vendor({});
    const two = await pinStops(one.stops, { geocoder: second.geocoder, charge: free, sleep: noSleep });
    // The centre is read off the stops pinned last time, never bought again.
    expect(second.calls).toEqual(["Stop 12, Kyoto", "Stop 13, Kyoto", "Stop 14, Kyoto"]);
    expect(two.stops.every((s) => s.location?.lat !== undefined)).toBe(true);
  });

  it("stops at the first quota refusal and asks no more", async () => {
    let charges = 0;
    const charge = async () => ++charges <= 2;
    const { geocoder, calls } = vendor({ Kyoto: hit(KYOTO, "Kyoto") });
    // A second city, because a refusal inside the first one ends that city's
    // loop anyway — what has to be shown is that Osaka is never even asked.
    await pinStops([stop("A"), stop("B"), stop("C", { city: "Osaka" })], { geocoder, charge, sleep: noSleep });
    expect(calls).toEqual(["Kyoto", "A, Kyoto"]);
    expect(charges).toBe(3);
  });

  it("paces its lookups at the vendor's interval", async () => {
    const slept: number[] = [];
    const { geocoder } = vendor({ Kyoto: hit(KYOTO, "Kyoto") });
    await pinStops([stop("A"), stop("B")], {
      geocoder,
      charge: free,
      sleep: async (ms) => void slept.push(ms),
    });
    expect(slept).toEqual([MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
  });
});
