import { describe, expect, it, vi } from "vitest";
import { SharedTripView } from "@tc/contracts";
import { JAPAN_TRIP_DAY_COUNT, JAPAN_TRIP_NAME, JAPAN_TRIP_TRAVELLERS } from "@tc/fixtures";

// The claim this whole change rests on: nothing in the demo trip's import
// graph opens a database. `db/client.ts` constructs a `pg.Pool` at module
// load, so a `Pool` that throws on construction turns any accidental import —
// direct, or transitive through a helper someone moves later — into a failing
// test rather than a connection on a public, unauthenticated path.
//
// This is why `toSharedView` lives in its own module (`access/sharedView.ts`)
// rather than in `access/shares.ts`, which does import the client.
vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      throw new Error("the demo trip must not reach the database");
    }
  },
}));

const { DEMO_TRIP_ID, demoSharedTripView, demoTrip, demoTripDetail } = await import("./demoTrip");

// The fixture's own numbers, not a second copy of them: these are what
// `pnpm seed:verify` pins, and the demo is the same fold.
const SCHEDULED = 68;
const BACKLOG = 4;
const ACTIVITIES = 72;

describe("the demo trip", () => {
  it("is the whole Japan fixture, folded through the real domain", () => {
    const view = demoSharedTripView();
    expect(view.name).toBe(JAPAN_TRIP_NAME);
    expect(view.days).toHaveLength(JAPAN_TRIP_DAY_COUNT);
    expect(view.days.reduce((n, d) => n + d.activityIds.length, 0)).toBe(SCHEDULED);
    expect(view.backlog).toHaveLength(BACKLOG);
    expect(Object.keys(view.activities)).toHaveLength(ACTIVITIES);
    expect(view.tripCostTotal).toBeGreaterThan(0);
    expect(view.budget?.amountMinor).toBeGreaterThan(0);
  });

  it("is served through the same contract as any other share", () => {
    // The route parses on the way out; if the fold ever produced something
    // `SharedTripView` refuses, this fails here rather than in a browser.
    expect(() => SharedTripView.parse(demoSharedTripView())).not.toThrow();
  });

  it("drops everything a public read drops", () => {
    const view = demoSharedTripView() as unknown as Record<string, unknown>;
    for (const field of ["members", "conflicts", "dismissedConflictIds", "status"]) {
      expect(view[field]).toBeUndefined();
    }
    // …while the full detail behind the clone path keeps them.
    expect(demoTripDetail().members.length).toBeGreaterThan(0);
  });

  it("is never stale, and pins itself at the end of its own fold", () => {
    const { seq, view } = demoTrip();
    expect(seq).toBeGreaterThan(ACTIVITIES);
    expect(view.seq).toBe(seq);
    expect(view.stale).toBe(false);
  });

  it("declares the fixture's traveller count rather than the folded member list", () => {
    // A folded trip has exactly one member — the actor that "issued" the
    // commands. `travellerCount` is the fixture's, deliberately.
    expect(demoTripDetail().members).toHaveLength(1);
    expect(demoSharedTripView().travellerCount).toBe(JAPAN_TRIP_TRAVELLERS);
  });

  it("is upcoming — every day of it is in the future", () => {
    const view = demoSharedTripView();
    const today = new Date().toISOString().slice(0, 10);
    expect(view.startDate).not.toBeNull();
    expect(view.startDate! > today).toBe(true);
    for (const day of view.days) expect(day.date! > today).toBe(true);
  });

  it("renders the same ids on every call, and none a real trip could hold", () => {
    const first = demoSharedTripView();
    const second = demoSharedTripView();
    expect(second).toBe(first); // memoised, not re-folded
    expect(first.tripId).toBe(DEMO_TRIP_ID);
    // Valid v4-shaped uuids (the contract requires it), counter-derived from
    // an all-zeros prefix that `randomUUID` cannot produce.
    for (const day of first.days) expect(day.dayId).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
    for (const id of Object.keys(first.activities)) {
      expect(id).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
    }
  });
});
