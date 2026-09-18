import { describe, expect, it } from "vitest";
import { Location, PostalAddress, TripDetail, GeocodeOutcome, GeocodeCandidates } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000c";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000c1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000f";

// A `trip_details.doc` written before Location grew `address`. The read route
// runs `TripDetail.parse` on raw jsonb, so this must keep parsing (M18 lesson;
// see location-precision.test.ts).
const PRE_ADDRESS_DOC = {
  tripId: TRIP,
  name: "Korea",
  status: "active",
  startDate: "2026-10-01",
  currency: "USD",
  budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-01", costSubtotal: 0 }],
  backlog: [],
  activities: {
    [A1]: {
      activityId: A1,
      title: "Makgeolli alley evening",
      timeWindow: null,
      location: { name: "Makgeolli alley", lat: 35.8, lng: 127.1, city: "Jeonju-si", countryCode: "KR", precision: "venue" },
      notes: null,
      anchors: [],
      kind: "planned",
      tags: [],
      cost: null,
    },
  },
  conflicts: [],
  dismissedConflictIds: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  unscheduledCostSubtotal: 0,
  tripCostTotal: 0,
  budgetRemaining: null,
};

describe("Location.address", () => {
  it("a document written before `address` existed still parses", () => {
    expect(TripDetail.safeParse(PRE_ADDRESS_DOC).success).toBe(true);
  });

  it("accepts addresses shaped the way three different countries write them", () => {
    const uk = { countryCode: "GB", lines: ["221B Baker Street"], locality: "London", postalCode: "NW1 6XE" };
    const de = { countryCode: "DE", lines: ["Hauptstraße 5"], locality: "Heidelberg", postalCode: "69117" };
    const jp = {
      countryCode: "JP",
      lines: ["1-2-3 Nishi-Azabu"],
      dependentLocality: "Minato-ku",
      locality: "Tokyo",
      postalCode: "106-0031",
    };
    for (const a of [uk, de, jp]) expect(PostalAddress.safeParse(a).success).toBe(true);
  });

  it("keeps a postal code's leading zero because it is a string", () => {
    const parsed = PostalAddress.parse({ countryCode: "US", lines: ["1 Main St"], postalCode: "02134" });
    expect(parsed.postalCode).toBe("02134");
  });

  it("refuses an address with no street-level line", () => {
    expect(PostalAddress.safeParse({ countryCode: "FR", lines: [], locality: "Paris" }).success).toBe(false);
  });

  it("refuses a lowercase or three-letter country code", () => {
    expect(PostalAddress.safeParse({ countryCode: "fr", lines: ["1 rue X"] }).success).toBe(false);
    expect(PostalAddress.safeParse({ countryCode: "FRA", lines: ["1 rue X"] }).success).toBe(false);
  });

  it("allows an address with no coordinates, and an address with coordinates", () => {
    const address = { countryCode: "GB", lines: ["221B Baker Street"] };
    expect(Location.safeParse({ name: "Sherlock Holmes Museum", address }).success).toBe(true);
    expect(Location.safeParse({ name: "Sherlock Holmes Museum", lat: 51.5238, lng: -0.1586, address }).success).toBe(true);
  });

  it("refuses a location whose countryCode disagrees with its address's", () => {
    const r = Location.safeParse({
      name: "X",
      countryCode: "FR",
      address: { countryCode: "GB", lines: ["221B Baker Street"] },
    });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join("."))).toContain("address.countryCode");
  });
});

describe("public API geocode vocabulary", () => {
  it("names every outcome the Geocode-Outcome header can carry", () => {
    expect(GeocodeOutcome.options).toEqual(["provided", "address", "name", "no-match", "quota-exhausted", "unavailable"]);
  });

  it("geocode results are Locations, so a candidate is a valid stop location as-is", () => {
    const body = { results: [{ name: "Colosseum, Rome, Italy", lat: 41.89, lng: 12.49, countryCode: "IT", city: "Rome" }] };
    const parsed = GeocodeCandidates.parse(body);
    expect(Location.safeParse(parsed.results[0]).success).toBe(true);
  });
});
