import { describe, expect, it } from "vitest";
import { SharedTripView, TripDetail, TripShare } from "../src";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

const share = {
  shareId: "3c5e7f90-2222-4333-8444-555566667777",
  tripId,
  token: "tok",
  seq: 12,
  createdBy: "dev-alice",
  createdAt: "2026-08-01T00:00:00.000Z",
  revokedAt: null,
};

const view = {
  tripId,
  name: "Kyoto",
  startDate: null,
  currency: "USD",
  budget: null,
  days: [],
  backlog: [],
  activities: {},
  unscheduledCostSubtotal: 0,
  tripCostTotal: 0,
  travellerCount: 1,
  seq: 12,
  sharedAt: "2026-08-01T00:00:00.000Z",
  stale: false,
};

describe("TripShare", () => {
  it("round-trips", () => {
    expect(TripShare.parse(share)).toEqual(share);
  });

  // seq is 1-based, matching `events.seq`: a share at seq N replays the first
  // N events, and there is no trip at all before N=1 (TripCreated).
  it("rejects a pin below the first event", () => {
    expect(TripShare.safeParse({ ...share, seq: 0 }).success).toBe(false);
  });

  it("rejects a fractional pin", () => {
    expect(TripShare.safeParse({ ...share, seq: 1.5 }).success).toBe(false);
  });
});

describe("SharedTripView", () => {
  it("round-trips", () => {
    expect(SharedTripView.parse(view)).toEqual(view);
  });

  // A public read is the one place a field leaks to people the trip's owner
  // never chose, so this is an explicit field list rather than a spread of
  // TripDetail — and this test is what keeps it one.
  it("carries none of TripDetail's private fields", () => {
    const keys = Object.keys(SharedTripView.shape);
    for (const forbidden of ["members", "conflicts", "dismissedConflictIds", "status"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("strips them even when they are supplied", () => {
    const parsed = SharedTripView.parse({
      ...view,
      members: [{ userId: "dev-alice", role: "owner" }],
      conflicts: [],
      status: "active",
    });
    expect(Object.keys(parsed)).not.toContain("members");
    expect(JSON.stringify(parsed)).not.toContain("dev-alice");
  });

  // Every planning field the public view DOES carry has to keep meaning the
  // same thing as its TripDetail counterpart, or the page renders one shape
  // against another's data.
  it("shares its planning field names with TripDetail", () => {
    const detailKeys = new Set(Object.keys(TripDetail.shape));
    const shareOnly = new Set(["travellerCount", "seq", "sharedAt", "stale"]);
    for (const key of Object.keys(SharedTripView.shape)) {
      if (shareOnly.has(key)) continue;
      expect(detailKeys, `${key} is not a TripDetail field`).toContain(key);
    }
  });

  it("requires at least one traveller — a trip always has an owner", () => {
    expect(SharedTripView.safeParse({ ...view, travellerCount: 0 }).success).toBe(false);
  });
});
