import { describe, expect, it } from "vitest";
import { DistanceUnit, UpdateUserPreferences, UserPreferences } from "../src";

const preferences = {
  displayName: "Mitchell",
  homeAirport: "SFO",
  distanceUnit: "km",
};

describe("UserPreferences", () => {
  it("accepts a fully populated set", () => {
    expect(UserPreferences.parse(preferences)).toEqual(preferences);
  });

  it("accepts null for both unsettable fields", () => {
    const cleared = { displayName: null, homeAirport: null, distanceUnit: "mi" };
    expect(UserPreferences.parse(cleared)).toEqual(cleared);
  });

  // Absent is NOT the same as null here — the DTO always carries every field,
  // so a reader never has to decide whether "missing" meant "unset" or "not
  // returned". Both omissions must fail.
  it.each(["displayName", "homeAirport", "distanceUnit"])("requires %s to be present", (field) => {
    const partial: Record<string, unknown> = { ...preferences };
    delete partial[field];
    expect(UserPreferences.safeParse(partial).success).toBe(false);
  });

  it("has no unset state for distanceUnit", () => {
    expect(UserPreferences.safeParse({ ...preferences, distanceUnit: null }).success).toBe(false);
  });

  describe("homeAirport", () => {
    it("takes a three-letter uppercase code", () => {
      expect(UserPreferences.parse({ ...preferences, homeAirport: "LHR" }).homeAirport).toBe("LHR");
    });

    // The package holds no transforms by convention, so the schema REJECTS a
    // lowercase code rather than upcasing it. Normalizing "sfo" is the
    // accepting route's job, before the parse. If this ever starts passing,
    // someone added a transform here and the route's normalization became
    // dead code that nothing would catch.
    it("rejects lowercase rather than coercing it", () => {
      expect(UserPreferences.safeParse({ ...preferences, homeAirport: "sfo" }).success).toBe(false);
    });

    it.each(["", "SF", "SFOO", "SF1", "SF ", "San Francisco"])("rejects %o", (code) => {
      expect(UserPreferences.safeParse({ ...preferences, homeAirport: code }).success).toBe(false);
    });
  });

  describe("displayName", () => {
    it("rejects an empty string, which would render as a nameless person", () => {
      expect(UserPreferences.safeParse({ ...preferences, displayName: "" }).success).toBe(false);
    });

    it("accepts 80 characters and refuses 81", () => {
      expect(UserPreferences.safeParse({ ...preferences, displayName: "a".repeat(80) }).success).toBe(true);
      expect(UserPreferences.safeParse({ ...preferences, displayName: "a".repeat(81) }).success).toBe(false);
    });
  });

  it("admits exactly two distance units", () => {
    expect(DistanceUnit.options).toEqual(["km", "mi"]);
    expect(DistanceUnit.safeParse("miles").success).toBe(false);
  });
});

describe("UpdateUserPreferences", () => {
  it("takes one field on its own", () => {
    expect(UpdateUserPreferences.parse({ distanceUnit: "mi" })).toEqual({ distanceUnit: "mi" });
  });

  // Absent means "leave it alone"; explicit null means "clear it". The two are
  // different operations and the schema has to keep them distinguishable.
  it("distinguishes clearing a field from omitting it", () => {
    expect(UpdateUserPreferences.parse({ displayName: null })).toEqual({ displayName: null });
    expect(UpdateUserPreferences.parse({ homeAirport: "SFO" })).not.toHaveProperty("displayName");
  });

  it("refuses an empty patch rather than treating it as a no-op", () => {
    expect(UpdateUserPreferences.safeParse({}).success).toBe(false);
  });

  // Found by review on #111. `Object.keys` counts a key whose value is
  // `undefined`, so `{ displayName: undefined }` looked like a real patch while
  // asking for nothing — the exact case the refusal above exists to catch,
  // slipping through the check meant to enforce it.
  it("refuses a patch whose only keys are undefined", () => {
    expect(UpdateUserPreferences.safeParse({ displayName: undefined }).success).toBe(false);
    expect(UpdateUserPreferences.safeParse({ displayName: undefined, homeAirport: undefined }).success).toBe(false);
  });

  // …but `null` is a real instruction ("clear it") and must still pass.
  it("accepts a patch whose only value is null", () => {
    expect(UpdateUserPreferences.safeParse({ displayName: null }).success).toBe(true);
  });

  it("still validates the fields it is given", () => {
    expect(UpdateUserPreferences.safeParse({ homeAirport: "sfo" }).success).toBe(false);
    expect(UpdateUserPreferences.safeParse({ displayName: "" }).success).toBe(false);
    expect(UpdateUserPreferences.safeParse({ distanceUnit: "furlongs" }).success).toBe(false);
  });
});
