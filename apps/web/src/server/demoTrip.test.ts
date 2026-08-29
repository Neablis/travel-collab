import { describe, expect, it, vi } from "vitest";
import { TripDetail, TripHistory } from "@tc/contracts";
import { JAPAN_TRIP_DAY_COUNT, JAPAN_TRIP_NAME, JAPAN_TRIP_TRAVELLERS } from "@tc/fixtures";
import { DEMO_TRIP_ID } from "@/lib/demoTrip";

// The claim the whole change rests on: nothing in the demo trip's import graph
// opens a database. `db/client.ts` constructs a `pg.Pool` at module load, so a
// `Pool` that throws on construction turns any accidental import — direct, or
// transitive through a helper someone moves later — into a failing test rather
// than a connection on a public, unauthenticated path.
vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      throw new Error("the demo trip must not reach the database");
    }
  },
}));

const { demoTripDetail, demoTripDetailAt, demoTripHeadSeq, demoTripHistory, demoTripMembers } =
  await import("./demoTrip");

// The fixture's own numbers, which `pnpm seed:verify` pins. The demo is the
// same fold, so if these drift apart one of the two is wrong.
const SCHEDULED = 68;
const BACKLOG = 4;
const ACTIVITIES = 72;

describe("the demo trip", () => {
  it("is the whole Japan fixture, folded through the real domain", () => {
    const detail = demoTripDetail();
    expect(detail.tripId).toBe(DEMO_TRIP_ID);
    expect(detail.name).toBe(JAPAN_TRIP_NAME);
    expect(detail.days).toHaveLength(JAPAN_TRIP_DAY_COUNT);
    expect(detail.days.reduce((n, d) => n + d.activityIds.length, 0)).toBe(SCHEDULED);
    expect(detail.backlog).toHaveLength(BACKLOG);
    expect(Object.keys(detail.activities)).toHaveLength(ACTIVITIES);
    expect(detail.tripCostTotal).toBeGreaterThan(0);
    expect(detail.budget?.amountMinor).toBeGreaterThan(0);
  });

  it("is served through the same contract the board reads for any trip", () => {
    // `/api/trips/:id` parses on the way out; a fold that drifted out of
    // `TripDetail`'s shape fails here rather than in someone's browser.
    expect(() => TripDetail.parse(demoTripDetail())).not.toThrow();
    expect(() => TripHistory.parse(demoTripHistory())).not.toThrow();
  });

  it("carries what the lenses need: dates, coordinates and conflicts", () => {
    const detail = demoTripDetail();
    // The Map and Timeline lenses have nothing to draw without coordinates,
    // and the Calendar has nothing to lay out without per-day dates.
    for (const day of detail.days) expect(day.date).not.toBeNull();
    const located = Object.values(detail.activities).filter(
      (a) => a.location?.lat !== undefined && a.location?.lng !== undefined,
    );
    expect(located).toHaveLength(ACTIVITIES);
    // Conflicts are what the board's banner is for — a demo with none never
    // shows that the product notices anything (the fixture pins 2).
    expect(detail.conflicts.length).toBeGreaterThan(0);
  });

  it("is upcoming — every day of it is in the future", () => {
    const detail = demoTripDetail();
    const today = new Date().toISOString().slice(0, 10);
    expect(detail.startDate).not.toBeNull();
    expect(detail.startDate! > today).toBe(true);
    for (const day of detail.days) expect(day.date! > today).toBe(true);
  });

  it("renders the same ids on every call, and none a real trip could hold", () => {
    const first = demoTripDetail();
    expect(demoTripDetail()).toBe(first); // memoised, not re-folded
    // Valid v4-shaped uuids (the contract requires it), counter-derived from
    // an all-zeros prefix that `randomUUID` cannot produce.
    for (const day of first.days) expect(day.dayId).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
    for (const id of Object.keys(first.activities)) {
      expect(id).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
    }
  });
});

describe("the demo trip's history", () => {
  it("reads as a real planning session, one entry per command group", () => {
    const history = demoTripHistory();
    expect(history.tripId).toBe(DEMO_TRIP_ID);
    // Genesis plus the fixture's own per-day grouping — the grouping db:seed
    // uses, and the reason the History popover is worth opening on the demo.
    expect(history.entries.length).toBeGreaterThan(JAPAN_TRIP_DAY_COUNT);
    for (const entry of history.entries) expect(entry.description).not.toBe("");
    // Newest first, like a real trip's.
    const seqs = history.entries.map((e) => e.fromSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  });

  it("offers no undo or redo, because the demo refuses every write", () => {
    // `deriveUndoRedo` over these envelopes would say canUndo — advertising an
    // action the server will refuse is the board lying to the one visitor
    // least equipped to tell.
    expect(demoTripHistory().canUndo).toBe(false);
    expect(demoTripHistory().canRedo).toBe(false);
  });

  it("replays to a point in its own history, for the preview", () => {
    const head = demoTripHeadSeq();
    expect(head).toBeGreaterThan(ACTIVITIES);
    // Genesis alone: a named trip with nothing planned yet.
    const first = demoTripDetailAt(1);
    expect(first?.name).toBe(JAPAN_TRIP_NAME);
    expect(first?.days).toHaveLength(0);
    // …and the head replays back to what the board shows.
    expect(demoTripDetailAt(head)?.days).toHaveLength(JAPAN_TRIP_DAY_COUNT);
  });

  it("refuses a seq outside its own stream", () => {
    expect(demoTripDetailAt(0)).toBeNull();
    expect(demoTripDetailAt(demoTripHeadSeq() + 1)).toBeNull();
    expect(demoTripDetailAt(1.5)).toBeNull();
  });
});

describe("the demo trip's travellers", () => {
  it("are the fixture's count, so the Travelers row shows a group", () => {
    const members = demoTripMembers();
    expect(members).toHaveLength(JAPAN_TRIP_TRAVELLERS);
    expect(members[0]!.role).toBe("owner");
    // Invented people: no email on a public page, ever.
    for (const member of members) {
      expect(member.name).toBeTruthy();
      expect(member.email).toBeNull();
    }
  });

  it("are overlaid onto the detail too, not just the access read", () => {
    // The board renders `detail.members` in three places — the meta pill's
    // count, the timeline's attribution chip, the map card's. With the fold's
    // own single synthetic member it read "1 travellers" beside a raw uuid on
    // every card.
    const members = demoTripDetail().members;
    expect(members).toHaveLength(JAPAN_TRIP_TRAVELLERS);
    // The id IS the label: TripMember carries no display name, and the
    // timeline renders `member.userId` directly.
    expect(members.map((m) => m.userId)).toEqual(demoTripMembers().map((m) => m.name));
  });
});
