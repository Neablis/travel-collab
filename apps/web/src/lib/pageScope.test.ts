import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR_ID } from "@tc/contracts";
import { provenanceLabel, scopeLabel } from "./pageScope";

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

describe("scopeLabel", () => {
  it("calls a notebook with no day binding trip-wide", () => {
    expect(scopeLabel({ tripId: TRIP_ID })).toBe("Trip-wide");
  });

  it("counts days from one, not from zero", () => {
    // The stored `index` is 0-based and the label a person reads is not.
    // Off by one here means the notebook for the arrival day is badged as the
    // day before the trip starts.
    expect(scopeLabel({ tripId: TRIP_ID, dayRef: { kind: "index", index: 0 } })).toBe("Day 1");
    expect(scopeLabel({ tripId: TRIP_ID, dayRef: { kind: "index", index: 5 } })).toBe("Day 6");
  });

  it("does not claim an ordinal it cannot compute for a pinned day", () => {
    const dayId = "7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c";
    // Resolving a `dayId` to "Day 6" needs the trip's day list, which neither
    // caller loads. Saying "One day" is the honest answer; inventing a number
    // would be the dishonest one.
    expect(scopeLabel({ tripId: TRIP_ID, dayRef: { kind: "dayId", dayId } })).toBe("One day");
  });
});

describe("provenanceLabel", () => {
  it("names a seeded notebook as one that came with the trip", () => {
    expect(provenanceLabel({ actorId: SYSTEM_ACTOR_ID })).toBe("Comes with your trip");
  });

  it("names any other notebook as the reader's own", () => {
    expect(provenanceLabel({ actorId: "dev-alice" })).toBe("Yours");
  });

  it("does not treat a person whose id merely resembles the sentinel as the seeder", () => {
    // The sentinel is an exact value, not a prefix. A substring test here
    // would hand "Comes with your trip" to anyone signing in as `system-2`,
    // and the seeded/authored split is the only thing this line knows.
    expect(provenanceLabel({ actorId: "system-2" })).toBe("Yours");
    expect(provenanceLabel({ actorId: "System" })).toBe("Yours");
  });
});
