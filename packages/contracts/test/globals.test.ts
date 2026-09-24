import { describe, expect, it } from "vitest";
import { buildAttributeManifest, TripGlobals } from "../src";

// The time-zone fields (M14 link 11). Additive and nullable, with defaults, so
// a response built before them — a cached one, a v1 client's recorded fixture —
// still parses rather than failing the page that reads it.
describe("TripGlobals time zones", () => {
  const older = {
    days: [{ index: 0, date: "2026-06-21", cities: ["Tokyo"], activityCount: 1, costSubtotal: 0 }],
    cities: [],
    tags: [],
    bookedCount: 0,
  };

  it("parses a response from before the fields existed, as unknown rather than as a guess", () => {
    const parsed = TripGlobals.parse(older);
    expect(parsed.days[0]).toMatchObject({ place: null, timeZone: null });
    expect(parsed.homeTimeZone).toBeNull();
  });

  it("reads a place from before it carried its city as a place with no city", () => {
    const day = { ...older.days[0]!, place: { lat: 35.68, lng: 139.77 }, timeZone: "Asia/Tokyo" };
    expect(TripGlobals.parse({ ...older, days: [day] }).days[0]!.place).toEqual({ lat: 35.68, lng: 139.77, city: null });
  });

  it("refuses a place that is not a point on the earth", () => {
    const day = { ...older.days[0]!, place: { lat: 91, lng: 0 }, timeZone: "Asia/Tokyo" };
    expect(TripGlobals.safeParse({ ...older, days: [day] }).success).toBe(false);
  });

  it("publishes the day's zone to the field picker, and neither the coordinates nor the reader's zone", () => {
    const days = buildAttributeManifest().find((e) => e.kind === "collection" && e.collection === "days");
    const fields = days?.kind === "collection" ? days.fields : [];
    expect(fields.find((f) => f.field === "timeZone")).toMatchObject({ valueKind: "text", label: "The day's time zone" });
    expect(fields.map((f) => f.field)).not.toContain("place");
    const trip = buildAttributeManifest().filter((e) => e.object === "trip").map((e) => (e.kind === "value" ? e.field : e.collection));
    expect(trip).not.toContain("homeTimeZone");
  });
});
