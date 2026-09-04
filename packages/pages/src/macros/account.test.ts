import { describe, expect, it } from "vitest";
import type { TripDetail, UserPreferences } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { accountName, accountHomeAirport } from "./account";
import type { WidgetContext } from "../registry-types";

// Found by Copilot on PR 134: neither account widget had a behaviour test that
// could tell them apart. The registry sweep only checks the rendered *kind*,
// and the PageScreen tests render only `account.name` — so pointing
// `account.homeAirport` at `displayName` (or the reverse) left the whole suite
// green. These read DIFFERENT fields from the same context, which is the one
// thing a shared-context resolver can most easily get wrong.
// From the factory rather than a partial forced through `as unknown`, which
// hid contract drift from the type checker as well as breaking the repository's
// test-data rule (Copilot, PR 139). Only `tripId` matters here — an account
// widget reads nothing else off the trip, which is the point of these two.
const trip: TripDetail = tripDetailFixture();
const ctx = (user: UserPreferences | null): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user,
  globals: null,
});

const prefs = (over: Partial<UserPreferences> = {}): UserPreferences => ({
  displayName: "Priya",
  homeAirport: "SFO",
  distanceUnit: "km",
  ...over,
});

describe("account widgets read the field they name", () => {
  it("account.name resolves the chosen name, not the airport", () => {
    expect(accountName.resolve(ctx(prefs()), {})).toEqual({ status: "ok", value: "Priya" });
  });

  it("account.homeAirport resolves the airport, not the name", () => {
    expect(accountHomeAirport.resolve(ctx(prefs()), {})).toEqual({ status: "ok", value: "SFO" });
  });

  // The cross-check that makes the two above load-bearing: with only one field
  // set, a resolver reading the wrong one reports `empty` instead of a value.
  it("account.name is empty when only the airport is set", () => {
    expect(accountName.resolve(ctx(prefs({ displayName: null })), {}).status).toBe("empty");
  });

  it("account.homeAirport is empty when only the name is set", () => {
    expect(accountHomeAirport.resolve(ctx(prefs({ homeAirport: null })), {}).status).toBe("empty");
  });

  it("both are empty when preferences did not load at all", () => {
    expect(accountName.resolve(ctx(null), {}).status).toBe("empty");
    expect(accountHomeAirport.resolve(ctx(null), {}).status).toBe("empty");
  });

  it("renders each as a single text segment", () => {
    expect(accountName.render("Priya")).toEqual({ kind: "inline", segs: [{ kind: "text", text: "Priya" }] });
    expect(accountHomeAirport.render("SFO")).toEqual({ kind: "inline", segs: [{ kind: "text", text: "SFO" }] });
  });
});

// ADR-037 open question 2, and the case Copilot flagged on PR 134 as the reason
// `trip` had to become optional: an account widget resolves on a notebook with
// no trip at all. If these ever start needing one, root-account notebooks are
// blocked and nobody finds out until they are built.
describe("account widgets need no trip", () => {
  const noTrip: WidgetContext = { page: { tripId: "11111111-1111-1111-1111-111111111111" }, user: prefs(), globals: null };

  it("resolve against a context carrying no trip", () => {
    expect(accountName.resolve(noTrip, {})).toEqual({ status: "ok", value: "Priya" });
    expect(accountHomeAirport.resolve(noTrip, {})).toEqual({ status: "ok", value: "SFO" });
  });
});
