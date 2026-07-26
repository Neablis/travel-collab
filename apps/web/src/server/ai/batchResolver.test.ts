import { describe, expect, it } from "vitest";
import type { BatchableCommand, TripDetail } from "@tc/contracts";
import { hydrate, tripDetailFromState } from "@tc/domain";
import { tripDetailFixture } from "../../mocks/fixtures";
import { resolveBatch, type RawToolIntent } from "./batchResolver";

const TRIP_ID = "165220a1-58c2-4acc-a5da-d04450758b87";
const ACTOR = "user-1";

// Deterministic id minter: valid, distinct UUIDs in a predictable order so
// tests can assert linkage between a minted id and later references to it.
function sequentialMinter() {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
  };
}

// A trip with `days` existing days (dayId d0…d{n-1}) and no activities.
function tripWithDays(dayIds: string[]): TripDetail {
  return tripDetailFixture({
    days: dayIds.map((dayId) => ({ dayId, activityIds: [], date: null, costSubtotal: 0 })),
  });
}

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const D3 = "33333333-3333-4333-8333-333333333333";

function resolve(intents: RawToolIntent[], detail: TripDetail) {
  return resolveBatch(intents, detail, { tripId: TRIP_ID, actorId: ACTOR, mintId: sequentialMinter() });
}

// A detail whose `conflicts` are DERIVED, not asserted — round-tripping through
// the domain guarantees the resolver's ref map and decideTripCommand's own
// detectConflicts agree about which conflicts exist.
function derivedDetail(detail: TripDetail): TripDetail {
  return tripDetailFromState(hydrate(detail), detail.createdAt);
}

function activity(activityId: string, title: string, timeWindow: { start: string; end: string } | null) {
  return { activityId, title, timeWindow, location: null, notes: null, anchors: [], cost: null };
}

// Two days, each holding a genuine time-overlap pair → exactly two conflicts,
// sorted by id (`time-overlap:<dayId>:…`), so D1's is ref #1 and D2's is ref #2.
function tripWithTwoConflicts(): TripDetail {
  const ids = ["a", "b", "c", "d"].map((c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
  const [a1, a2, b1, b2] = ids as [string, string, string, string];
  return derivedDetail(
    tripDetailFixture({
      days: [
        { dayId: D1, activityIds: [a1, a2], date: null, costSubtotal: 0 },
        { dayId: D2, activityIds: [b1, b2], date: null, costSubtotal: 0 },
      ],
      activities: {
        [a1]: activity(a1, "Colosseum", { start: "09:00", end: "11:00" }),
        [a2]: activity(a2, "Forum", { start: "10:00", end: "12:00" }),
        [b1]: activity(b1, "Vatican", { start: "09:00", end: "11:00" }),
        [b2]: activity(b2, "Trastevere", { start: "10:00", end: "12:00" }),
      },
    }),
  );
}

describe("resolveBatch — batch-aware dependency resolution", () => {
  it("resolves an activity onto a day created earlier in the SAME batch", () => {
    // The whole point: 'day 2' does not exist in the pre-batch trip (1 day);
    // it's the day AddDay adds. Activities referencing it must land on it.
    const detail = tripWithDays([D1]);
    const intents: RawToolIntent[] = [
      { type: "AddDay", args: {} },
      { type: "AddActivity", args: { title: "Lunch", dayRef: "day 2" } },
      { type: "AddActivity", args: { title: "Dinner", dayRef: "day 2" } },
    ];

    const { commands, errors } = resolve(intents, detail);

    expect(errors).toEqual([]);
    expect(commands).toHaveLength(3);
    const addDay = commands[0] as Extract<BatchableCommand, { type: "AddDay" }>;
    const lunch = commands[1] as Extract<BatchableCommand, { type: "AddActivity" }>;
    const dinner = commands[2] as Extract<BatchableCommand, { type: "AddActivity" }>;
    // Both activities point at the newly-minted day's id — not D1, not invented.
    expect(lunch.dayId).toBe(addDay.dayId);
    expect(dinner.dayId).toBe(addDay.dayId);
    expect(addDay.dayId).not.toBe(D1);
  });

  it("counts existing + batch-added days so 'day N' hits the right new day", () => {
    // Trip has 2 days; add 2 more; 'day 4' is the second added day.
    const detail = tripWithDays([D1, D2]);
    const intents: RawToolIntent[] = [
      { type: "AddDay", args: {} },
      { type: "AddDay", args: {} },
      { type: "AddActivity", args: { title: "Late arrival", dayRef: "day 4" } },
    ];

    const { commands, errors } = resolve(intents, detail);

    expect(errors).toEqual([]);
    const secondNewDay = commands[1] as Extract<BatchableCommand, { type: "AddDay" }>;
    const activityCmd = commands[2] as Extract<BatchableCommand, { type: "AddActivity" }>;
    expect(activityCmd.dayId).toBe(secondNewDay.dayId);
  });

  it("resolves a later command against an activity added earlier in the batch (by title)", () => {
    const detail = tripWithDays([D1]);
    const intents: RawToolIntent[] = [
      { type: "AddActivity", args: { title: "Museum", dayRef: "day 1" } },
      { type: "RemoveActivity", args: { activityRef: "Museum" } },
    ];

    const { commands, errors } = resolve(intents, detail);

    expect(errors).toEqual([]);
    const added = commands[0] as Extract<BatchableCommand, { type: "AddActivity" }>;
    const removed = commands[1] as Extract<BatchableCommand, { type: "RemoveActivity" }>;
    expect(removed.activityId).toBe(added.activityId);
  });
});

describe("resolveBatch — minting and injection", () => {
  it("mints activityId + injects tripId; the model supplies neither", () => {
    const detail = tripWithDays([D1]);
    const { commands } = resolve([{ type: "AddActivity", args: { title: "Coffee", dayRef: "day 1" } }], detail);

    const cmd = commands[0] as Extract<BatchableCommand, { type: "AddActivity" }>;
    expect(cmd.tripId).toBe(TRIP_ID);
    expect(cmd.activityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(cmd.dayId).toBe(D1);
    expect(cmd.title).toBe("Coffee");
  });

  it("omitted / 'backlog' dayRef leaves the activity in the backlog (no dayId)", () => {
    const detail = tripWithDays([D1]);
    const { commands } = resolve(
      [
        { type: "AddActivity", args: { title: "Flight" } },
        { type: "AddActivity", args: { title: "Hotel", dayRef: "backlog" } },
      ],
      detail,
    );

    expect((commands[0] as Extract<BatchableCommand, { type: "AddActivity" }>).dayId).toBeUndefined();
    expect((commands[1] as Extract<BatchableCommand, { type: "AddActivity" }>).dayId).toBeUndefined();
  });
});

describe("resolveBatch — errors are per-command, not fatal to the batch", () => {
  it("drops an out-of-range dayRef but keeps the resolvable commands", () => {
    const detail = tripWithDays([D1]);
    const intents: RawToolIntent[] = [
      { type: "AddActivity", args: { title: "Good", dayRef: "day 1" } },
      { type: "AddActivity", args: { title: "Bad", dayRef: "day 9" } },
    ];

    const { commands, errors } = resolve(intents, detail);

    expect(commands).toHaveLength(1);
    expect((commands[0] as Extract<BatchableCommand, { type: "AddActivity" }>).title).toBe("Good");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, type: "AddActivity" });
    expect(errors[0]!.message).toMatch(/out of range/i);
  });

  it("drops an ambiguous activity ref without guessing", () => {
    // Two existing activities share a title.
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const detail = tripDetailFixture({
      days: [{ dayId: D1, activityIds: [a, b], date: null, costSubtotal: 0 }],
      activities: {
        [a]: { activityId: a, title: "Park", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
        [b]: { activityId: b, title: "Park", timeWindow: null, location: null, notes: null, anchors: [], cost: null },
      },
    });

    const { commands, errors } = resolve([{ type: "RemoveActivity", args: { activityRef: "Park" } }], detail);

    expect(commands).toHaveLength(0);
    expect(errors[0]!.message).toMatch(/matches 2/i);
  });

  it("resolves RemoveDay's day by 'day N' against the existing trip", () => {
    const detail = tripWithDays([D1, D2]);
    const { commands, errors } = resolve([{ type: "RemoveDay", args: { dayRef: "day 2" } }], detail);

    expect(errors).toEqual([]);
    expect((commands[0] as Extract<BatchableCommand, { type: "RemoveDay" }>).dayId).toBe(D2);
  });

  it("drops a DismissConflict whose ref number isn't in the context", () => {
    const detail = tripWithDays([D1]); // no conflicts
    const { commands, errors } = resolve([{ type: "DismissConflict", args: { conflictRef: 1 } }], detail);

    expect(commands).toHaveLength(0);
    expect(errors[0]!.message).toMatch(/no conflict #1/i);
  });
});

describe("resolveBatch — the running state tracks removals and moves", () => {
  it("renumbers day refs after a RemoveDay earlier in the same batch", () => {
    // days [D1,D2,D3]; removing day 1 makes the OLD day 3 the new "day 2".
    const detail = tripWithDays([D1, D2, D3]);
    const { commands, errors } = resolve(
      [
        { type: "RemoveDay", args: { dayRef: "day 1" } },
        { type: "AddActivity", args: { title: "Lunch", dayRef: "day 2" } },
      ],
      detail,
    );

    expect(errors).toEqual([]);
    expect((commands[0] as Extract<BatchableCommand, { type: "RemoveDay" }>).dayId).toBe(D1);
    // The append-only projection resolved this to D2. It must be D3.
    expect((commands[1] as Extract<BatchableCommand, { type: "AddActivity" }>).dayId).toBe(D3);
  });

  it("drops a ref to a day the batch already removed, instead of aborting the batch", () => {
    // The escalation case: previously both commands 'resolved', then the whole
    // atomic batch rolled back on day-not-found. Now the second is dropped.
    const detail = tripWithDays([D1, D2]);
    const { commands, errors } = resolve(
      [
        { type: "RemoveDay", args: { dayRef: "day 1" } },
        { type: "AddActivity", args: { title: "Orphan", dayRef: D1 } },
      ],
      detail,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]!.type).toBe("RemoveDay");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 1, type: "AddActivity" });
  });

  it("scrubs a removed activity from title resolution", () => {
    const detail = tripWithDays([D1]);
    const { commands, errors } = resolve(
      [
        { type: "AddActivity", args: { title: "Museum", dayRef: "day 1" } },
        { type: "RemoveActivity", args: { activityRef: "Museum" } },
        { type: "UpdateActivity", args: { activityRef: "Museum", notes: "too late" } },
      ],
      detail,
    );

    expect(commands).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ index: 2, type: "UpdateActivity" });
    expect(errors[0]!.message).toMatch(/no activity named/i);
  });

  it("tracks a MoveActivity, so repeating it is a skipped no-op", () => {
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const detail = tripDetailFixture({
      days: [
        { dayId: D1, activityIds: [a], date: null, costSubtotal: 0 },
        { dayId: D2, activityIds: [], date: null, costSubtotal: 0 },
      ],
      activities: { [a]: activity(a, "Museum", null) },
    });
    const move: RawToolIntent = { type: "MoveActivity", args: { activityRef: "Museum", dayRef: "day 2", position: 0 } };

    const { commands, errors } = resolve([move, move], detail);

    expect(commands).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe("no-op");
  });
});

describe("resolveBatch — a domain rejection drops one command, never the batch", () => {
  it("skips a no-op sub-command and keeps the rest", () => {
    const detail = tripWithDays([D1]); // fixture currency is already USD
    const { commands, errors } = resolve(
      [
        { type: "SetTripCurrency", args: { currency: "USD" } },
        { type: "AddDay", args: {} },
      ],
      detail,
    );

    expect(commands).toHaveLength(1);
    expect(commands[0]!.type).toBe("AddDay");
    expect(errors[0]).toMatchObject({ type: "SetTripCurrency", code: "no-op" });
  });

  it("drops a second dismissal of the same conflict with the domain's own code", () => {
    const detail = tripWithTwoConflicts();
    const dismiss: RawToolIntent = { type: "DismissConflict", args: { conflictRef: 1 } };

    const { commands, errors } = resolve([dismiss, dismiss], detail);

    expect(commands).toHaveLength(1);
    expect(errors[0]!.code).toBe("conflict-already-dismissed");
  });

  it("resolves DismissConflict by its 1-based ref to the real (derivable) conflict id", () => {
    const detail = tripWithTwoConflicts();
    const expected = detail.conflicts[1]!.id;

    const { commands, errors } = resolve([{ type: "DismissConflict", args: { conflictRef: 2 } }], detail);

    expect(errors).toEqual([]);
    expect((commands[0] as Extract<BatchableCommand, { type: "DismissConflict" }>).conflictId).toBe(expected);
  });
});
