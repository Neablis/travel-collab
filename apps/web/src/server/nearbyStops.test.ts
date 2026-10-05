import { describe, expect, it } from "vitest";
import { SavedStop, type Location } from "@tc/contracts";
import { locationFactory } from "@tc/factories";
import { rankNearbyStops, type NearbyStopsCandidateDay, type RankNearbyStopsInput } from "./nearbyStops";

// M34's ranking, rule by rule (`docs/plans/2026-10-05-M34-nearby-stops.md`
// §2.2). Which days a reader may see at all is the query's job and is held by
// the route's integration test; everything here is what is worth OFFERING from
// days already allowed.

const KYOTO = { lat: 35.0116, lng: 135.7681 };

/** A Kyoto venue `km` kilometres due north of `KYOTO` (one degree of latitude is ~111.2 km). */
function kyotoAt(name: string, km: number): Location {
  return locationFactory.build({ name, city: "Kyoto", lat: KYOTO.lat + km / 111.2, lng: KYOTO.lng, precision: "venue" });
}

/** A stored stop, read through the contract as the query reads one. */
function stop(fields: { title: string; location: Location | null } & Partial<SavedStop>): SavedStop {
  return SavedStop.parse({ timeWindow: null, notes: null, anchors: [], kind: "planned", tags: [], cost: null, ...fields });
}

let dayCount = 0;
function day(stops: SavedStop[], name?: string): NearbyStopsCandidateDay {
  const n = ++dayCount;
  return { savedDayId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: name ?? `Day ${n}`, stops };
}

function rank(input: Partial<RankNearbyStopsInput> & Pick<RankNearbyStopsInput, "days">) {
  return rankNearbyStops({ cities: ["Kyoto"], anchor: null, titlesOnDay: [], ...input });
}

const titles = (input: Parameters<typeof rank>[0]) => rank(input).map((s) => s.title);

describe("rankNearbyStops", () => {
  it("offers only stops in one of the day's cities, matched case-insensitively", () => {
    const days = [
      day([
        stop({ title: "Kinkaku-ji", location: kyotoAt("Kinkaku-ji", 5) }),
        stop({ title: "Dotonbori", location: locationFactory.build({ name: "Dotonbori", city: "Osaka" }) }),
      ]),
    ];
    expect(titles({ days, cities: ["kyoto"] })).toEqual(["Kinkaku-ji"]);
  });

  it("does not offer a stop with no place, or a place with no city", () => {
    const days = [
      day([
        stop({ title: "Somewhere", location: null }),
        stop({ title: "Cityless", location: { name: "Cityless" } }),
        stop({ title: "Kinkaku-ji", location: kyotoAt("Kinkaku-ji", 5) }),
      ]),
    ];
    expect(titles({ days })).toEqual(["Kinkaku-ji"]);
  });

  // D7.
  it("does not offer a transit stop", () => {
    const days = [
      day([
        stop({ title: "Train to Osaka", location: kyotoAt("Kyoto Station", 1), kind: "transit", mode: "train" }),
        stop({ title: "Kinkaku-ji", location: kyotoAt("Kinkaku-ji", 5) }),
      ]),
    ];
    expect(titles({ days })).toEqual(["Kinkaku-ji"]);
  });

  // D8.
  it("does not offer a stop already on the day, whatever its case or spacing", () => {
    const days = [
      day([
        stop({ title: "Kinkaku-ji", location: kyotoAt("Kinkaku-ji", 5) }),
        stop({ title: "Nishiki Market", location: kyotoAt("Nishiki Market", 1) }),
      ]),
    ];
    expect(titles({ days, titlesOnDay: ["  KINKAKU-JI "] })).toEqual(["Nishiki Market"]);
  });

  // D9.
  it("collapses the same stop from two days into one row counting both", () => {
    const first = day([stop({ title: "Kinkaku-ji", location: kyotoAt("Kinkaku-ji", 5) })], "First");
    const second = day([stop({ title: "kinkaku-JI", location: kyotoAt("KINKAKU-JI", 5) })], "Second");
    const ranked = rank({ days: [first, second] });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({ title: "Kinkaku-ji", playbookCount: 2, savedDayName: "First" });
  });

  it("keeps a later copy of a duplicate when only it can be measured", () => {
    const cityOnly = locationFactory.build({ name: "Kinkaku-ji", city: "Kyoto", ...KYOTO, precision: "city" });
    const first = day([stop({ title: "Kinkaku-ji", location: cityOnly })], "First");
    const second = day([stop({ title: "Kinkaku-ji", location: kyotoAt("Kinkaku-ji", 5) })], "Second");
    const [only] = rank({ days: [first, second], anchor: KYOTO });
    expect(only).toMatchObject({ savedDayName: "Second", playbookCount: 2 });
    expect(only!.distanceKm).toBeCloseTo(5, 1);
  });

  // D1: a city centre is not where the stop is, so it is not ranked by it.
  it("ranks closest first, and puts a city-centre stop after a further venue", () => {
    const centre = locationFactory.build({ name: "Kyoto", city: "Kyoto", ...KYOTO, precision: "city" });
    const days = [
      day([
        stop({ title: "Far", location: kyotoAt("Far", 9) }),
        stop({ title: "Centre", location: centre }),
        stop({ title: "Near", location: kyotoAt("Near", 1) }),
      ]),
    ];
    const ranked = rank({ days, anchor: KYOTO });
    expect(ranked.map((s) => s.title)).toEqual(["Near", "Far", "Centre"]);
    expect(ranked[0]!.distanceKm).toBeCloseTo(1, 1);
    expect(ranked[2]!.distanceKm).toBeNull();
  });

  it("measures nothing with no anchor, and breaks ties by how many days carry a stop", () => {
    const once = stop({ title: "Alpha", location: kyotoAt("Alpha", 1) });
    const twice = stop({ title: "Zeta", location: kyotoAt("Zeta", 9) });
    const ranked = rank({ days: [day([once, twice]), day([twice])] });
    expect(ranked.map((s) => [s.title, s.playbookCount, s.distanceKm])).toEqual([
      ["Zeta", 2, null],
      ["Alpha", 1, null],
    ]);
  });

  // D5.
  it("offers at most 40", () => {
    const many = Array.from({ length: 45 }, (_, i) => stop({ title: `Stop ${i}`, location: kyotoAt(`Stop ${i}`, i) }));
    const ranked = rank({ days: [day(many)], anchor: KYOTO });
    expect(ranked).toHaveLength(40);
    expect(ranked.at(-1)!.title).toBe("Stop 39");
  });

  it("gives the length from the window, midnight-ending at 23:59, and null with no window", () => {
    const days = [
      day([
        stop({ title: "Temple", location: kyotoAt("Temple", 1), timeWindow: { start: "09:00", end: "10:30" } }),
        stop({ title: "Late", location: kyotoAt("Late", 2), timeWindow: { start: "22:00", end: "23:59" } }),
        stop({ title: "Untimed", location: kyotoAt("Untimed", 3) }),
      ]),
    ];
    expect(rank({ days, anchor: KYOTO }).map((s) => [s.title, s.lengthMinutes])).toEqual([
      ["Temple", 90],
      ["Late", 120],
      ["Untimed", null],
    ]);
  });
});
