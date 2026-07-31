import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripCommand, TripEvent } from "@tc/contracts";
import {
  decideTripCommand,
  detectConflicts,
  diffTripStates,
  evolveTrip,
  tripStatesEqual,
  type TripState,
} from "../src";
import { witness } from "./support/witness";
import {
  CTX,
  TRIP,
  foldTo,
  generator,
  historyFrom,
  rawOp,
  resetGeneratorCounters,
  uuid,
} from "./support/tripGenerator";

describe("diffTripStates round-trip (THE M2 invariant)", () => {
  it("applying the diff to current reproduces the target exactly, for any history and any cut point", () => {
    const w = witness("M2 round-trip");
    fc.assert(
      fc.property(
        fc.array(rawOp, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (rawOps, cutSeed) => {
          const events = historyFrom(rawOps);
          const cut = (cutSeed % events.length) + 1; // 1..length
          const current = foldTo(events, events.length);
          const target = foldTo(events, cut);
          const diff = diffTripStates(current, target);
          let result = current;
          for (const event of diff) result = evolveTrip(result, event);
          w.tick();
          expect(tripStatesEqual(result, target)).toBe(true);
          // conflicts are a pure function of state, so they match too:
          expect(detectConflicts(result)).toEqual(detectConflicts(target));
        },
      ),
      { numRuns: 300 },
    );
    w.atLeast(300);
  });

  // Guards the generator itself, not the domain. See the `generator` counters.
  it("the generator explores a real input space, not a degenerate one", () => {
    resetGeneratorCounters();
    fc.assert(
      fc.property(fc.array(rawOp, { minLength: 1, maxLength: 40 }), (rawOps) => {
        historyFrom(rawOps);
      }),
      { numRuns: 100 },
    );

    // Measured 2026-07-28 over repeated runs: ~360-435 commands built per 100
    // runs at a 74-82% acceptance rate. Re-measured 2026-07-31 (M8) after
    // widening rawOp.op to 0-12 for SetTripName/DeleteTrip/RestoreTrip:
    // ~399-506 commands built at a 57-60% acceptance rate — lower than before
    // because DeleteTrip flips status to "deleted", and the domain rejects
    // every command but RestoreTrip against a deleted trip, so a chunk of
    // subsequently-built commands in the same history are now rejected as
    // no-ops of a different kind. Both floors sit well below the new range too,
    // so they still catch a collapse without flapping on run-to-run variance.
    expect(generator.built).toBeGreaterThan(200);
    // Most built commands should survive `decide`. A collapse here means the
    // properties above are still green but barely testing anything.
    const acceptanceRate = generator.accepted / generator.built;
    expect(
      acceptanceRate,
      `only ${(acceptanceRate * 100).toFixed(1)}% of generated commands were accepted ` +
        `(${generator.accepted}/${generator.built}) — the properties in this file are ` +
        `exploring far less than they appear to`,
    ).toBeGreaterThan(0.5);
  });

  it("diff(x, x) is empty", () => {
    fc.assert(
      fc.property(fc.array(rawOp, { minLength: 1, maxLength: 30 }), (rawOps) => {
        const events = historyFrom(rawOps);
        const current = foldTo(events, events.length);
        expect(diffTripStates(current, current)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

// KI-1. The shrunk counterexample the property test above had been finding
// ~1-in-5 runs since 2026-07-12, pinned deterministically. Day ORDER carries
// meaning (ordinal = array position = the day's date), and two states can hold
// the *same set* of dayIds in a different order once a day is removed and
// re-added. Step 3 of diffTripStates used to rebuild only when a target day was
// missing from current, so an order-only difference emitted no day events at
// all and the revert silently produced the wrong day sequence.
describe("diffTripStates day ordering (KI-1 regression)", () => {
  const DAY_A = uuid(101);
  const DAY_B = uuid(102);

  // B added first, then A. B is removed, then re-added — so it lands at the END.
  // The earlier state has [B, A]; the later state has [A, B]. Same set, different
  // order. Reverting from the later state to the earlier one must reorder.
  function statesWithSameDaysInDifferentOrder(): { current: TripState; target: TripState } {
    const events: TripEvent[] = [];
    let state: TripState | null = null;
    const apply = (command: TripCommand): void => {
      const decision = decideTripCommand(state, command, CTX);
      if (!decision.ok) throw new Error(`setup rejected ${command.type}: ${decision.rejection.code}`);
      for (const event of decision.events) {
        events.push(event);
        state = evolveTrip(state, event);
      }
    };
    apply({ type: "CreateTrip", tripId: TRIP, name: "Ordering" });
    apply({ type: "AddDay", tripId: TRIP, dayId: DAY_B });
    apply({ type: "AddDay", tripId: TRIP, dayId: DAY_A });
    const targetSeq = events.length; // days are [B, A] here
    apply({ type: "RemoveDay", tripId: TRIP, dayId: DAY_B });
    apply({ type: "AddDay", tripId: TRIP, dayId: DAY_B }); // re-added → appended

    return { current: foldTo(events, events.length), target: foldTo(events, targetSeq) };
  }

  it("emits day events when the two states differ only in day ORDER", () => {
    const { current, target } = statesWithSameDaysInDifferentOrder();
    expect(current.days.map((d) => d.dayId)).toEqual([DAY_A, DAY_B]);
    expect(target.days.map((d) => d.dayId)).toEqual([DAY_B, DAY_A]);

    expect(diffTripStates(current, target)).not.toEqual([]);
  });

  it("applying that diff reproduces the target's day order exactly", () => {
    const { current, target } = statesWithSameDaysInDifferentOrder();

    let result = current;
    for (const event of diffTripStates(current, target)) result = evolveTrip(result, event);

    expect(result.days.map((d) => d.dayId)).toEqual(target.days.map((d) => d.dayId));
    expect(tripStatesEqual(result, target)).toBe(true);
  });

  it("still emits nothing when the day lists are already identical", () => {
    const { current } = statesWithSameDaysInDifferentOrder();
    expect(diffTripStates(current, current)).toEqual([]);
  });
});

// M8. Task A1 added SetTripName (and DeleteTrip/RestoreTrip), falsifying
// diffTripStates' old precondition comment that name/status never differ
// between two states of one trip. tripStatesEqual (Task A3) now compares both,
// so if diffTripStates doesn't reconcile them, undo/redo/revert across a
// rename or delete silently fails to restore the target — same shape as KI-1.
describe("diffTripStates lifecycle reconciliation (M8)", () => {
  const tripId = "11111111-1111-4111-8111-111111111111";
  const base = evolveTrip(null, {
    type: "TripCreated", version: 1, payload: { tripId, name: "Japan", createdBy: "u1" },
  });

  it("emits a rename when the names differ", () => {
    const target = { ...base, name: "Japan 2027" };
    const events = diffTripStates(base, target);
    expect(events.map((e) => e.type)).toContain("TripNameSet");
    expect(tripStatesEqual(events.reduce(evolveTrip, base), target)).toBe(true);
  });

  it("emits a delete when the target is deleted", () => {
    const target = { ...base, status: "deleted" as const };
    const events = diffTripStates(base, target);
    expect(events.map((e) => e.type)).toEqual(["TripDeleted"]);
    expect(tripStatesEqual(events.reduce(evolveTrip, base), target)).toBe(true);
  });

  it("restores FIRST so later reconciliation applies to a live trip", () => {
    const current = { ...base, status: "deleted" as const };
    const target = { ...base, name: "Renamed" };
    const events = diffTripStates(current, target);
    expect(events[0]!.type).toBe("TripRestored");
    expect(tripStatesEqual(events.reduce(evolveTrip, current), target)).toBe(true);
  });

  it("deletes LAST so the delete is not applied before the rest of the diff", () => {
    const current = { ...base, name: "Old" };
    const target = { ...base, name: "New", status: "deleted" as const };
    const events = diffTripStates(current, target);
    expect(events[events.length - 1]!.type).toBe("TripDeleted");
    expect(tripStatesEqual(events.reduce(evolveTrip, current), target)).toBe(true);
  });

  it("emits nothing for identical states", () => {
    expect(diffTripStates(base, base)).toEqual([]);
  });
});
