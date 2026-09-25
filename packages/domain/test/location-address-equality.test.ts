import { describe, expect, it } from "vitest";
import type { Location } from "@tc/contracts";
import { activityStatesEqual, type ActivityState } from "../src";

// equality.ts compares Location field by field, so a contract field it forgets
// is a field diff() treats as unchanged — an edit that revert/undo silently
// keeps at its old value, with no failure anywhere to say so. `address` is the
// same hand-enumeration trap KI-35 and KI-54 both walked into, one field later,
// and the most expensive one to lose: a corrected street number is invisible in
// the coordinates, so nothing else in the stop would show the difference.
const activity = (patch: { location: Location }): ActivityState => ({
  title: "Dinner at Gonpachi",
  timeWindow: null,
  notes: null,
  anchors: [],
  kind: "planned" as const,
  tags: [],
  cost: null,
  bookedBy: null,
  participants: [],
  mode: null,
  endLocation: null,
  ...patch,
});

describe("`address` is part of activity equality", () => {
  it("a stop whose only change is its address is NOT equal (else undo/revert keeps the old address)", () => {
    const base = { name: "Museum", lat: 51.5, lng: -0.15 };
    const a = activity({ location: { ...base, address: { countryCode: "GB", lines: ["221B Baker Street"] } } });
    const b = activity({ location: { ...base, address: { countryCode: "GB", lines: ["221 Baker Street"] } } });
    expect(activityStatesEqual(a, b)).toBe(false);
  });

  it("identical addresses compare equal, including absent vs absent", () => {
    const address = { countryCode: "JP", lines: ["1-2-3 Nishi-Azabu"], locality: "Tokyo", postalCode: "106-0031" };
    expect(activityStatesEqual(activity({ location: { name: "X", address } }), activity({ location: { name: "X", address: { ...address, lines: [...address.lines] } } }))).toBe(true);
    expect(activityStatesEqual(activity({ location: { name: "X" } }), activity({ location: { name: "X" } }))).toBe(true);
  });

  it("absent vs present address is not equal", () => {
    expect(activityStatesEqual(activity({ location: { name: "X" } }), activity({ location: { name: "X", address: { countryCode: "GB", lines: ["1 A St"] } } }))).toBe(false);
  });
});
