import { describe, expect, it } from "vitest";
import type { BatchableCommand, TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "../../mocks/fixtures";
import { resolveBatch, type RawToolIntent } from "./batchResolver";

const TRIP_ID = "165220a1-58c2-4acc-a5da-d04450758b87";

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

function resolve(intents: RawToolIntent[], detail: TripDetail) {
  return resolveBatch(intents, detail, { tripId: TRIP_ID, mintId: sequentialMinter() });
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
    const activity = commands[2] as Extract<BatchableCommand, { type: "AddActivity" }>;
    expect(activity.dayId).toBe(secondNewDay.dayId);
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

  it("resolves DismissConflict by its 1-based ref number to the real conflict id", () => {
    const c1 = "conflict-id-one";
    const c2 = "conflict-id-two";
    const detail = tripDetailFixture({
      days: [{ dayId: D1, activityIds: [], date: null, costSubtotal: 0 }],
      conflicts: [
        { id: c1, kind: "overlap", severity: "warn", subjects: [], description: "a", resolutions: [] },
        { id: c2, kind: "overlap", severity: "warn", subjects: [], description: "b", resolutions: [] },
      ],
      dismissedConflictIds: [],
    });

    // The model dismisses conflict "#2" (its ref in the envelope), never a raw id.
    const { commands, errors } = resolve([{ type: "DismissConflict", args: { conflictRef: 2 } }], detail);

    expect(errors).toEqual([]);
    expect((commands[0] as Extract<BatchableCommand, { type: "DismissConflict" }>).conflictId).toBe(c2);
  });

  it("drops a DismissConflict whose ref number isn't in the context", () => {
    const detail = tripWithDays([D1]); // no conflicts
    const { commands, errors } = resolve([{ type: "DismissConflict", args: { conflictRef: 1 } }], detail);

    expect(commands).toHaveLength(0);
    expect(errors[0]!.message).toMatch(/no conflict #1/i);
  });
});
