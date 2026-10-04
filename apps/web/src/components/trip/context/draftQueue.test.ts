import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SUGGESTION_UNIT_COMMANDS_MAX, type BatchableCommand } from "@tc/contracts";
import { historyFixture, scenarios } from "@tc/factories";
import { predictBatch } from "@tc/predict";
import { witness } from "@/test-support/witness";
import { enqueueDraft } from "./draftQueue";
import { activeDetail, enqueue, type OptimisticState } from "./optimistic";

// A stop added in a draft keeps its later edits in the same change (W75;
// Mitchell's production test, 2026-10-04: add a stop, move it, and the tray
// said "2 changes not sent").

// Through the domain's projection once, as a server read is: the scenario's
// hand-computed dates and conflicts are not what the domain derives, so an
// emptied draft (which shows the confirmed trip) would differ from a replayed
// one for that reason alone. The property below found it.
const trip = (() => {
  const projected = predictBatch(scenarios.threeDayTrip(), []);
  if (!projected.ok) throw new Error("setup");
  return projected.detail;
})();
const tripId = trip.tripId;
const [day1, day2] = trip.days;
const existing = day1!.activityIds[0]!;
const NEW = "a0000000-0000-4000-8000-000000000001";

const start = (): OptimisticState => ({ confirmed: { detail: trip, history: historyFixture(tripId) }, pending: [] });

const add = (activityId = NEW, dayId = day1!.dayId): BatchableCommand => ({
  type: "AddActivity",
  tripId,
  activityId,
  dayId,
  title: "Gelato",
});
const move = (activityId: string, toDayId: string, position = 0): BatchableCommand => ({
  type: "MoveActivity",
  tripId,
  activityId,
  toDayId,
  position,
});
const rename = (activityId: string, title: string): BatchableCommand => ({ type: "UpdateActivity", tripId, activityId, title });
const remove = (activityId: string): BatchableCommand => ({ type: "RemoveActivity", tripId, activityId });

let n = 0;
/** Queues each gesture through `enqueueDraft`, failing the test on a refusal. */
function draft(...gestures: BatchableCommand[][]): OptimisticState {
  return gestures.reduce((state, commands) => {
    const r = enqueueDraft(state, `u${++n}`, commands);
    if (!r.ok) throw new Error(`refused: ${r.message}`);
    return r.state;
  }, start());
}

describe("enqueueDraft — a stop added in the draft", () => {
  it("folds a move of it into the change that added it", () => {
    const state = draft([add()], [move(NEW, day2!.dayId)]);

    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]!.commands).toEqual([add(), move(NEW, day2!.dayId)]);
    // The board shows where it ended up, not where it was added.
    expect(activeDetail(state).days[1]!.activityIds).toContain(NEW);
    expect(activeDetail(state).days[0]!.activityIds).not.toContain(NEW);
  });

  it("folds an edit of it in even with another change queued in between", () => {
    const state = draft([add()], [rename(existing, "Colosseum, early")], [rename(NEW, "Gelato, twice")]);

    expect(state.pending.map((u) => u.commands)).toEqual([
      [add(), rename(NEW, "Gelato, twice")],
      [rename(existing, "Colosseum, early")],
    ]);
    expect(activeDetail(state).activities[NEW]!.title).toBe("Gelato, twice");
  });

  it("drops the change that added it, and everything folded in, when it is removed again", () => {
    const state = draft([add()], [rename(NEW, "Gelato, twice")], [remove(NEW)]);

    expect(state.pending).toEqual([]);
    expect(activeDetail(state)).toEqual(trip);
  });

  it("keeps a removal as its own change when a later change still names the stop", () => {
    // The second gesture moves an existing stop too, so it is its own change
    // and depends on the add (W9); dropping the add would strand it.
    const reorder = [move(NEW, day1!.dayId, 0), move(existing, day2!.dayId, 0)];
    const state = draft([add()], reorder, [remove(NEW)]);

    expect(state.pending.map((u) => u.commands)).toEqual([[add()], reorder, [remove(NEW)]]);
  });

  it("keeps a change that also touches an existing stop as its own", () => {
    const state = draft([add()], [move(NEW, day1!.dayId, 0), move(existing, day2!.dayId, 0)]);

    expect(state.pending).toHaveLength(2);
  });

  it("keeps a change that also touches the trip as its own", () => {
    const newDay = "d0000000-0000-4000-8000-000000000001";
    const state = draft([add()], [{ type: "AddDay", tripId, dayId: newDay }, move(NEW, newDay)]);

    expect(state.pending).toHaveLength(2);
  });

  it(`keeps an edit as its own change once the one that added it holds ${SUGGESTION_UNIT_COMMANDS_MAX} edits`, () => {
    const renames = Array.from({ length: SUGGESTION_UNIT_COMMANDS_MAX }, (_, i) => [rename(NEW, `Gelato ${i + 1}`)]);
    const state = draft([add()], ...renames);

    expect(state.pending.map((u) => u.commands.length)).toEqual([SUGGESTION_UNIT_COMMANDS_MAX, 1]);
    expect(activeDetail(state).activities[NEW]!.title).toBe(`Gelato ${SUGGESTION_UNIT_COMMANDS_MAX}`);
  });
});

describe("enqueueDraft — a stop already on the trip", () => {
  it("is one change per gesture, as before", () => {
    const state = draft([rename(existing, "Colosseum, early")], [rename(existing, "Colosseum, late")]);

    expect(state.pending).toHaveLength(2);
  });
});

// The overlay must show the trip the plain queue would have shown: folding
// changes how the draft is grouped, never where it ends up. For ALL gesture
// sequences, so a property test (AGENTS.md testing model).
describe("enqueueDraft — the folded draft ends where the unfolded one does", () => {
  const ids = Array.from({ length: 3 }, (_, i) => `a0000000-0000-4000-8000-00000000010${i}`);
  const gesture = fc.oneof(
    fc.record({ kind: fc.constant("add" as const), id: fc.nat(2), day: fc.nat(2) }),
    fc.record({ kind: fc.constant("move" as const), pick: fc.nat(20), day: fc.nat(2), position: fc.nat(3) }),
    fc.record({ kind: fc.constant("rename" as const), pick: fc.nat(20), title: fc.constantFrom("A", "B", "C") }),
    fc.record({ kind: fc.constant("remove" as const), pick: fc.nat(20) }),
    fc.record({ kind: fc.constant("pair" as const), pick: fc.nat(20), day: fc.nat(2) }),
  );
  type Gesture = typeof gesture extends fc.Arbitrary<infer G> ? G : never;

  // Resolved against the trip as the draft shows it, as a person's gesture is.
  function commandsFor(g: Gesture, state: OptimisticState): BatchableCommand[] {
    const detail = activeDetail(state);
    const stops = Object.keys(detail.activities).sort();
    const pick = (i: number) => stops[i % stops.length]!;
    const day = (i: number) => detail.days[i % detail.days.length]!.dayId;
    switch (g.kind) {
      case "add":
        return [add(ids[g.id]!, day(g.day))];
      case "move":
        return [move(pick(g.pick), day(g.day), g.position)];
      case "rename":
        return [rename(pick(g.pick), g.title)];
      case "remove":
        return [remove(pick(g.pick))];
      case "pair":
        return [move(pick(g.pick), day(g.day), 0), move(pick(g.pick + 1), day(g.day), 0)];
    }
  }

  it("for any sequence of gestures", () => {
    const w = witness("draft fold");
    fc.assert(
      fc.property(fc.array(gesture, { maxLength: 12 }), (gestures) => {
        let plain = start();
        let folded = start();
        let i = 0;
        for (const g of gestures) {
          const commands = commandsFor(g, plain);
          const p = enqueue(plain, `p${++i}`, commands);
          const f = enqueueDraft(folded, `p${i}`, commands);
          expect(f.ok).toBe(p.ok);
          if (!p.ok || !f.ok) continue;
          plain = p.state;
          folded = f.state;
        }
        expect(activeDetail(folded)).toEqual(activeDetail(plain));
        // Ticks only where folding did something: a draft it never shortened
        // proves nothing about it.
        if (folded.pending.length < plain.pending.length) w.tick();
      }),
    );
    w.atLeast(3); // observed 7-20 folds per 100 runs, over 30 runs
  });
});
