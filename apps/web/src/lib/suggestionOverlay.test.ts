import fc from "fast-check";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchableCommand, SuggestionChange, TripDetail } from "@tc/contracts";
import { tripDetailFactory, uuidFrom } from "@tc/factories";
import { predictBatch } from "@tc/predict";
import { witness } from "@/test-support/witness";
import { suggestionOverlay } from "./suggestionOverlay";

// A pass-through spy, so the overlay's cost can be counted in predictions.
vi.mock("@tc/predict", async (orig) => {
  const actual = await orig<typeof import("@tc/predict")>();
  return { ...actual, predictBatch: vi.fn(actual.predictBatch) };
});

// Two days of two stops each, and one stop on the rack: enough for a move
// between days, a move to the rack, and a neighbour whose index shifts.
const confirmedTrip = (): TripDetail =>
  tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2, unscheduledCount: 1 } });

let next = 0;
const change = (
  trip: TripDetail,
  commands: BatchableCommand[],
  over: Partial<SuggestionChange> = {},
): SuggestionChange => ({
  id: uuidFrom(9000 + ++next, 7),
  suggestionId: uuidFrom(9999, 7),
  tripId: trip.tripId,
  authorId: "dev-bob",
  note: null,
  createdAt: "2026-10-03T10:00:00.000Z",
  commands,
  description: commands.map((c) => c.type).join(", "),
  status: "pending",
  dependsOn: [],
  resolvedBy: null,
  resolvedAt: null,
  ...over,
});

describe("suggestionOverlay", () => {
  it("an added stop is a ghost in the day it lands in, carrying the predicted stop", () => {
    const trip = confirmedTrip();
    const day = trip.days[1]!;
    const activityId = uuidFrom(8001, 7);
    const c = change(trip, [{ type: "AddActivity", tripId: trip.tripId, activityId, dayId: day.dayId, title: "Ramen" }]);

    const overlay = suggestionOverlay(trip, [c]);

    const ghosts = overlay.byDay.get(day.dayId) ?? [];
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ changeId: c.id, kind: "add", activityId, dayId: day.dayId, authorId: "dev-bob" });
    expect(ghosts[0]!.activity?.title).toBe("Ramen");
    expect(overlay.tripLevel).toEqual([]);
    expect(overlay.stale).toEqual([]);
  });

  it("a stop added to the rack is filed under the null day", () => {
    const trip = confirmedTrip();
    const activityId = uuidFrom(8002, 7);
    const c = change(trip, [{ type: "AddActivity", tripId: trip.tripId, activityId, title: "Onsen" }]);

    expect(suggestionOverlay(trip, [c]).byDay.get(null)?.map((g) => g.kind)).toEqual(["add"]);
  });

  // The neighbour that slides up a slot must not read as moved: only the stop
  // the change moved is marked (W5's diff, narrowed so a reviewer sees one
  // marker for one drag).
  it("a stop moved to another day is one move ghost on that stop, and its old neighbour is untouched", () => {
    const trip = confirmedTrip();
    const [from, to] = trip.days;
    const moved = from!.activityIds[0]!;
    const c = change(trip, [{ type: "MoveActivity", tripId: trip.tripId, activityId: moved, toDayId: to!.dayId, position: 0 }]);

    const overlay = suggestionOverlay(trip, [c]);

    expect([...overlay.byActivity.keys()]).toEqual([moved]);
    expect(overlay.byActivity.get(moved)).toMatchObject([{ kind: "move", dayId: to!.dayId }]);
    expect(overlay.byActivity.get(moved)![0]!.activity?.activityId).toBe(moved);
  });

  it("reordering within a day is a move", () => {
    const trip = confirmedTrip();
    const day = trip.days[0]!;
    const moved = day.activityIds[0]!;
    const c = change(trip, [{ type: "MoveActivity", tripId: trip.tripId, activityId: moved, toDayId: day.dayId, position: 1 }]);

    expect(suggestionOverlay(trip, [c]).byActivity.get(moved)?.map((g) => g.kind)).toEqual(["move"]);
  });

  it("a removed stop is a remove ghost on that stop, in the day it leaves", () => {
    const trip = confirmedTrip();
    const day = trip.days[1]!;
    const removed = day.activityIds[1]!;
    const c = change(trip, [{ type: "RemoveActivity", tripId: trip.tripId, activityId: removed }]);

    const overlay = suggestionOverlay(trip, [c]);

    expect(overlay.byActivity.get(removed)).toMatchObject([{ kind: "remove", dayId: day.dayId, activityId: removed }]);
    expect([...overlay.byActivity.keys()]).toEqual([removed]);
  });

  it("a changed field is an update carrying the new value", () => {
    const trip = confirmedTrip();
    const target = trip.days[0]!.activityIds[1]!;
    const c = change(trip, [{ type: "UpdateActivity", tripId: trip.tripId, activityId: target, title: "Tea ceremony" }]);

    const ghosts = suggestionOverlay(trip, [c]).byActivity.get(target);
    expect(ghosts?.map((g) => g.kind)).toEqual(["update"]);
    expect(ghosts![0]!.activity?.title).toBe("Tea ceremony");
  });

  it("a trip-level change has no stop to sit on, so it goes to tripLevel only", () => {
    const trip = confirmedTrip();
    const c = change(trip, [{ type: "SetTripName", tripId: trip.tripId, name: "Kansai" }]);

    const overlay = suggestionOverlay(trip, [c]);

    expect(overlay.tripLevel).toMatchObject([{ changeId: c.id, kind: "update" }]);
    expect(overlay.byActivity.size).toBe(0);
    expect(overlay.byDay.size).toBe(0);
  });

  it("an empty new day is trip-level", () => {
    const trip = confirmedTrip();
    const c = change(trip, [{ type: "AddDay", tripId: trip.tripId, dayId: uuidFrom(8003, 7) }]);

    expect(suggestionOverlay(trip, [c]).tripLevel.map((g) => g.kind)).toEqual(["add"]);
  });

  it("a change whose target is gone no longer applies", () => {
    const trip = confirmedTrip();
    const c = change(trip, [{ type: "RemoveActivity", tripId: trip.tripId, activityId: uuidFrom(8004, 7) }]);

    const overlay = suggestionOverlay(trip, [c]);

    expect(overlay.stale).toMatchObject([{ changeId: c.id, kind: "remove" }]);
    expect(overlay.byActivity.size + overlay.byDay.size + overlay.tripLevel.length).toBe(0);
  });

  // Accepting skips a sub-command that is already true (`decideInOrder`), so
  // the overlay must not call such a change broken (W51).
  it("a change whose move is already done still applies, as its retime", () => {
    const trip = confirmedTrip();
    const day = trip.days[0]!;
    const target = day.activityIds[0]!;
    const c = change(trip, [
      { type: "MoveActivity", tripId: trip.tripId, activityId: target, toDayId: day.dayId, position: 0 },
      { type: "UpdateActivity", tripId: trip.tripId, activityId: target, timeWindow: { start: "07:00", end: "08:00" } },
    ]);

    const overlay = suggestionOverlay(trip, [c]);

    expect(overlay.stale).toEqual([]);
    expect(overlay.byActivity.get(target)).toMatchObject([{ kind: "update", activity: { timeWindow: { start: "07:00" } } }]);
  });

  it("a change that is already true throughout no longer applies", () => {
    const trip = confirmedTrip();
    const day = trip.days[0]!;
    const c = change(trip, [
      { type: "MoveActivity", tripId: trip.tripId, activityId: day.activityIds[0]!, toDayId: day.dayId, position: 0 },
    ]);

    expect(suggestionOverlay(trip, [c]).stale.map((g) => g.changeId)).toEqual([c.id]);
  });

  it("only pending changes are drawn", () => {
    const trip = confirmedTrip();
    const target = trip.days[0]!.activityIds[0]!;
    const c = change(trip, [{ type: "RemoveActivity", tripId: trip.tripId, activityId: target }], { status: "dismissed" });

    expect(suggestionOverlay(trip, [c]).byActivity.size).toBe(0);
  });

  // W9: a draft's later unit can name a stop its earlier unit created. The
  // child only predicts on top of its parent, and is blocked by it until the
  // parent is accepted.
  it("a dependent is predicted on top of its parent, and is blocked by it", () => {
    const trip = confirmedTrip();
    const day = trip.days[0]!;
    const activityId = uuidFrom(8005, 7);
    const parent = change(trip, [{ type: "AddActivity", tripId: trip.tripId, activityId, dayId: day.dayId, title: "Market" }]);
    const child = change(
      trip,
      [{ type: "UpdateActivity", tripId: trip.tripId, activityId, title: "Nishiki Market" }],
      { dependsOn: [parent.id] },
    );

    const overlay = suggestionOverlay(trip, [parent, child]);

    expect(overlay.stale).toEqual([]);
    const ghosts = overlay.byActivity.get(activityId) ?? [];
    expect(ghosts.map((g) => [g.changeId, g.kind])).toEqual([
      [parent.id, "add"],
      [child.id, "update"],
    ]);
    expect(ghosts[1]!.activity?.title).toBe("Nishiki Market");
    expect(ghosts[1]!.blockedBy).toEqual([parent.id]);
    expect(ghosts[0]!.blockedBy).toEqual([]);
    // The stop the child edits is not on the board until the parent is
    // accepted, so the chip lists the child too — nothing is unreachable.
    expect(overlay.tripLevel.map((g) => g.changeId)).toEqual([child.id]);
  });

  it("a dependent of a parent that no longer applies no longer applies either", () => {
    const trip = confirmedTrip();
    const gone = uuidFrom(8006, 7);
    const parent = change(trip, [{ type: "MoveActivity", tripId: trip.tripId, activityId: gone, toDayId: null, position: 0 }]);
    const child = change(trip, [{ type: "SetTripName", tripId: trip.tripId, name: "x" }], { dependsOn: [parent.id] });

    expect(suggestionOverlay(trip, [parent, child]).stale.map((g) => g.changeId)).toEqual([parent.id, child.id]);
  });
});

// Review of #311, finding 3.7: each change used to be predicted from the
// confirmed trip up through every ancestor, so a chain of n cost n(n+1)/2
// predictions. A change's base is now its latest ancestor's outcome whenever
// that ancestor's own lineage is everything before it.
describe("suggestionOverlay reuses what it already predicted", () => {
  beforeEach(() => {
    vi.mocked(predictBatch).mockClear();
  });

  it("predicts a chain of n dependents n times, not n(n+1)/2", () => {
    const trip = confirmedTrip();
    const activityId = uuidFrom(8101, 7);
    const chain: SuggestionChange[] = [
      change(trip, [{ type: "AddActivity", tripId: trip.tripId, activityId, dayId: trip.days[0]!.dayId, title: "t0" }]),
    ];
    for (let i = 1; i < 10; i++) {
      chain.push(
        change(trip, [{ type: "UpdateActivity", tripId: trip.tripId, activityId, title: `t${i}` }], {
          dependsOn: [chain[i - 1]!.id],
        }),
      );
    }

    const overlay = suggestionOverlay(trip, chain);

    expect(overlay.stale).toEqual([]);
    expect(overlay.byActivity.get(activityId)!.at(-1)!.activity?.title).toBe("t9");
    expect(vi.mocked(predictBatch)).toHaveBeenCalledTimes(10);
  });

  // The branch that reuses part of a lineage and replays the rest: D depends
  // on B and C, which each depend only on A. B's outcome holds A and B but
  // not C, so C is replayed onto it, and D still sees all three.
  it("a change with two parents sees both, its base built on the one it can reuse", () => {
    const trip = confirmedTrip();
    const activityId = uuidFrom(8102, 7);
    const a = change(trip, [{ type: "AddActivity", tripId: trip.tripId, activityId, dayId: trip.days[0]!.dayId, title: "Market" }]);
    const b = change(trip, [{ type: "UpdateActivity", tripId: trip.tripId, activityId, title: "Nishiki" }], { dependsOn: [a.id] });
    const c = change(trip, [{ type: "UpdateActivity", tripId: trip.tripId, activityId, notes: "cash only" }], { dependsOn: [a.id] });
    const d = change(trip, [{ type: "UpdateActivity", tripId: trip.tripId, activityId, cost: { amountMinor: 1200, currency: trip.currency } }], {
      dependsOn: [b.id, c.id],
    });

    const ghost = suggestionOverlay(trip, [a, b, c, d]).byActivity.get(activityId)!.find((g) => g.changeId === d.id)!;

    expect(ghost.kind).toBe("update");
    expect(ghost.activity).toMatchObject({ title: "Nishiki", notes: "cash only", cost: { amountMinor: 1200 } });
    expect(ghost.blockedBy).toEqual([b.id, c.id]);
  });
});

// The overlay runs on the provider's confirmed trip, which is React state and
// the base of the optimistic queue: a mutation here would show on the board as
// a change nobody made.
describe("suggestionOverlay purity", () => {
  it("never mutates the confirmed trip, whatever it is given", () => {
    const w = witness("overlay never mutates confirmed");
    const trip = confirmedTrip();
    const ids = [...trip.days.flatMap((d) => d.activityIds), ...trip.backlog];
    const dayIds = trip.days.map((d) => d.dayId);
    const fresh = fc.integer({ min: 1, max: 50 }).map((n) => uuidFrom(7000 + n, 7));
    const activityId = fc.oneof(fc.constantFrom(...ids), fresh);
    const dayId = fc.oneof(fc.constantFrom(...dayIds), fresh);
    const command: fc.Arbitrary<BatchableCommand> = fc.oneof(
      fc.record({ activityId, dayId, title: fc.string({ minLength: 1, maxLength: 8 }) }).map(
        (c): BatchableCommand => ({ type: "AddActivity", tripId: trip.tripId, ...c }),
      ),
      fc.record({ activityId, toDayId: fc.option(dayId), position: fc.nat(3) }).map(
        (c): BatchableCommand => ({ type: "MoveActivity", tripId: trip.tripId, ...c }),
      ),
      activityId.map((id): BatchableCommand => ({ type: "RemoveActivity", tripId: trip.tripId, activityId: id })),
      fc.record({ activityId, title: fc.string({ minLength: 1, maxLength: 8 }) }).map(
        (c): BatchableCommand => ({ type: "UpdateActivity", tripId: trip.tripId, ...c }),
      ),
      dayId.map((id): BatchableCommand => ({ type: "RemoveDay", tripId: trip.tripId, dayId: id })),
      dayId.map((id): BatchableCommand => ({ type: "AddDay", tripId: trip.tripId, dayId: id })),
      fc.string({ minLength: 1, maxLength: 8 }).map((name): BatchableCommand => ({ type: "SetTripName", tripId: trip.tripId, name })),
    );
    const changes = fc
      .array(
        fc.record({
          commands: fc.array(command, { minLength: 1, maxLength: 3 }),
          dependsOnEarlier: fc.boolean(),
          status: fc.constantFrom("pending", "pending", "accepted", "dismissed"),
        }),
        { minLength: 1, maxLength: 6 },
      )
      .map((specs) => {
        const built: SuggestionChange[] = [];
        for (const s of specs) {
          const prev = built.at(-1);
          built.push(
            change(trip, s.commands, {
              status: s.status as SuggestionChange["status"],
              dependsOn: s.dependsOnEarlier && prev ? [prev.id] : [],
            }),
          );
        }
        return built;
      });

    // The input space can shrink without a guard: a generator that drifts into
    // only ever naming missing stops makes every change stale, so the overlay
    // never runs a prediction to completion and "never mutates" proves little.
    const predicted = witness("a run that predicted a ghost");

    fc.assert(
      fc.property(changes, (cs) => {
        const before = structuredClone(trip);
        const overlay = suggestionOverlay(trip, cs);
        expect(trip).toEqual(before);
        w.tick();
        if (overlay.byActivity.size + overlay.tripLevel.length > 0) predicted.tick();
      }),
      { numRuns: 200 },
    );
    // No guard clause above: every run asserts, so the floor is exact.
    w.atLeast(200);
    // Measured 60-76 over ten runs (2026-10-03); the floor is half the minimum.
    predicted.atLeast(30);
  });
});
