import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { TripDetail, TripHistory } from "@tc/contracts";
import { recostDetail } from "@tc/domain";
import {
  JAPAN_DEMO_ROSTER,
  JAPAN_TRIP_DAY_COUNT,
  JAPAN_TRIP_NAME,
  JAPAN_TRIP_TRAVELLERS,
  parseBundle,
} from "@tc/fixtures";
import { DEMO_TRIP_ID, DEMO_TRIPS, demoTripBySlug } from "@/lib/demoTrip";

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

const { demoTripCards, demoTripDetail, demoTripDetailAt, demoTripHeadSeq, demoTripHistory, demoTripMembers } =
  await import("./demoTrip");

// The fixture's own numbers, which `pnpm seed:verify` pins. The demo is the
// same fold, so if these drift apart one of the two is wrong.
const SCHEDULED = 68;
const BACKLOG = 4;
const ACTIVITIES = 72;

describe("the demo trip", () => {
  it("is the whole Japan fixture, folded through the real domain", () => {
    const detail = demoTripDetail(DEMO_TRIP_ID);
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
    expect(() => TripDetail.parse(demoTripDetail(DEMO_TRIP_ID))).not.toThrow();
    expect(() => TripHistory.parse(demoTripHistory(DEMO_TRIP_ID))).not.toThrow();
  });

  it("carries what the lenses need: dates, coordinates and conflicts", () => {
    const detail = demoTripDetail(DEMO_TRIP_ID);
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
    const detail = demoTripDetail(DEMO_TRIP_ID);
    const today = new Date().toISOString().slice(0, 10);
    expect(detail.startDate).not.toBeNull();
    expect(detail.startDate! > today).toBe(true);
    for (const day of detail.days) expect(day.date! > today).toBe(true);
  });

  it("renders the same ids on every call, and none a real trip could hold", () => {
    const first = demoTripDetail(DEMO_TRIP_ID);
    expect(demoTripDetail(DEMO_TRIP_ID)).toBe(first); // memoised, not re-folded
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
    const history = demoTripHistory(DEMO_TRIP_ID);
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
    expect(demoTripHistory(DEMO_TRIP_ID).canUndo).toBe(false);
    expect(demoTripHistory(DEMO_TRIP_ID).canRedo).toBe(false);
  });

  it("replays to a point in its own history, for the preview", () => {
    const head = demoTripHeadSeq(DEMO_TRIP_ID);
    expect(head).toBeGreaterThan(ACTIVITIES);
    // Genesis alone: a named trip with nothing planned yet.
    const first = demoTripDetailAt(DEMO_TRIP_ID, 1);
    expect(first?.name).toBe(JAPAN_TRIP_NAME);
    expect(first?.days).toHaveLength(0);
    // …and the head replays back to what the board shows.
    expect(demoTripDetailAt(DEMO_TRIP_ID, head)?.days).toHaveLength(JAPAN_TRIP_DAY_COUNT);
  });

  it("refuses a seq outside its own stream", () => {
    expect(demoTripDetailAt(DEMO_TRIP_ID, 0)).toBeNull();
    expect(demoTripDetailAt(DEMO_TRIP_ID, demoTripHeadSeq(DEMO_TRIP_ID) + 1)).toBeNull();
    expect(demoTripDetailAt(DEMO_TRIP_ID, 1.5)).toBeNull();
  });
});

describe("the demo trip's travellers", () => {
  it("are the fixture's roster, so the People section shows a group", () => {
    const members = demoTripMembers(DEMO_TRIP_ID);
    expect(members).toHaveLength(JAPAN_DEMO_ROSTER.length);
    expect(members[0]!.role).toBe("owner");
    // ADR-064: the roster is the fixture's, so the suggester role has a demo.
    expect(members.map((m) => m.role)).toContain("suggester");
    // Invented people: no email on a public page, ever.
    for (const member of members) {
      expect(member.name).toBeTruthy();
      expect(member.email).toBeNull();
    }
  });

  // M38: the roster's own avatars and colours, resolved as a real trip's are.
  // Priya chose Sam's plum and joined after him, so `/demo` shows her shifted
  // — the one place a visitor without an account sees a clash.
  it("wear what they chose, with the later of two plums shifted", () => {
    const byName = new Map(demoTripMembers(DEMO_TRIP_ID).map((m) => [m.name, m]));
    expect(byName.get("Sam")).toMatchObject({ avatar: "mountain", color: "plum", colorShifted: false });
    expect(byName.get("Priya")).toMatchObject({ avatar: "camera", color: "ochre", colorShifted: true });
    expect(byName.get("Kenji")).toMatchObject({ avatar: null, color: "teal", colorShifted: false });
  });

  it("are overlaid onto the detail too, not just the access read", () => {
    // The board renders `detail.members` in three places — the meta pill's
    // count, the timeline's attribution chip, the map card's. With the fold's
    // own single synthetic member it read "1 travellers" beside a raw uuid on
    // every card.
    const members = demoTripDetail(DEMO_TRIP_ID).members;
    expect(members).toHaveLength(JAPAN_DEMO_ROSTER.length);
    // The id IS the label: TripMember carries no display name, and the
    // timeline renders `member.userId` directly.
    expect(members.map((m) => m.userId)).toEqual(demoTripMembers(DEMO_TRIP_ID).map((m) => m.name));
  });

  // The roster's one member not travelling is on no stop, so every total is
  // the four travellers' (ADR-060's per-person price, counted over travellers).
  // Counting him would price each everyone-stop for five.
  it("price the trip for the travellers, not for the member who is not going", () => {
    const detail = demoTripDetail(DEMO_TRIP_ID);
    expect(detail.members.filter((m) => m.travelling === false)).toHaveLength(1);
    expect(detail.tripCostTotal).toBe(recostDetail(detail, JAPAN_TRIP_TRAVELLERS).tripCostTotal);
  });
});

// M42's gate: every trip in `content/trips/` opens at `/demo/<slug>`. Read off
// the directory, not off a list in this file, so a bundle added there with no
// demo fails here rather than shipping invisible.
const TRIPS_DIR = new URL("../../../../content/trips/", import.meta.url);
const BUNDLED_TRIPS = readdirSync(TRIPS_DIR)
  .filter((file) => file.endsWith(".json"))
  .flatMap((file) => parseBundle(JSON.parse(readFileSync(new URL(file, TRIPS_DIR), "utf8"))).trips);

describe("a demo per bundled trip (M42 D1)", () => {
  it("has a slug for every trip in content/trips/, and none for a trip that is not there", () => {
    expect(BUNDLED_TRIPS.length).toBeGreaterThan(0);
    expect(DEMO_TRIPS.map((demo) => demo.slug).sort()).toEqual(["japan", ...BUNDLED_TRIPS.map((trip) => trip.key)].sort());
  });

  // The bundle FILE, folded: every stop on its day, the backlog parked, under
  // the file's own name. Not the production copy of the trip, which keeps the
  // tags it was first imported with.
  it.each(BUNDLED_TRIPS.map((trip) => [trip.key, trip] as const))("folds %s from its bundle file", (slug, trip) => {
    const detail = demoTripDetail(demoTripBySlug(slug)!.tripId);
    expect(detail.name).toBe(trip.name);
    expect(detail.days.map((day) => day.activityIds.length)).toEqual(trip.days.map((day) => day.stops.length));
    expect(detail.backlog).toHaveLength(trip.backlog.length);
    const tags = (stops: readonly { tags?: readonly string[] }[]) => stops.flatMap((stop) => stop.tags ?? []).sort();
    expect(tags(Object.values(detail.activities))).toEqual(tags([...trip.days.flatMap((day) => day.stops), ...trip.backlog]));
    // A generated crew, since a bundle names nobody: an owner first, everyone travelling.
    const members = demoTripMembers(demoTripBySlug(slug)!.tripId);
    expect(members.length).toBeGreaterThan(1);
    expect(members[0]!.role).toBe("owner");
    expect(detail.members.map((m) => m.userId)).toEqual(members.map((m) => m.name));
  });

  // Two demos sharing a day or stop id would be two trips sharing one row's
  // identity, and the client keys its caches on these ids.
  it("gives no two demos the same day or activity id", () => {
    const seen = new Map<string, string>();
    for (const { slug, tripId } of DEMO_TRIPS) {
      const detail = demoTripDetail(tripId);
      for (const id of [...detail.days.map((day) => day.dayId), ...Object.keys(detail.activities)]) {
        expect(seen.get(id), `${id} is in ${seen.get(id)} and ${slug}`).toBeUndefined();
        seen.set(id, slug);
      }
    }
  });
});

describe("the /demo picker", () => {
  it("lists every demo, Japan first, with its name, length and description", () => {
    const cards = demoTripCards();
    expect(cards.map((card) => card.slug)).toEqual(DEMO_TRIPS.map((demo) => demo.slug));
    expect(cards[0]).toMatchObject({ slug: "japan", name: JAPAN_TRIP_NAME, dayCount: JAPAN_TRIP_DAY_COUNT });
    for (const trip of BUNDLED_TRIPS) {
      expect(cards.find((card) => card.slug === trip.key)).toMatchObject({ name: trip.name, dayCount: trip.days.length });
    }
  });

  // Part 3's numbers, over every activity with the backlog included (ADR-070
  // §3). Iceland is the one that tells the two apart: its days alone read
  // "Outdoors & food".
  it("describes each trip as its copy would be described", () => {
    expect(Object.fromEntries(demoTripCards().map((card) => [card.slug, card.description]))).toEqual({
      japan: "Outdoors & sights",
      "dolomites-winter": "Outdoors & drinks",
      "iceland-ring-road": "Outdoorsy",
      "northern-spain": "Food & drinks",
      "thailand-andaman": "Food & beach",
    });
  });
});
