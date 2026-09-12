import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ActivityAddedV1, ActivityUpdatedV1, BatchableCommand, TripEvent } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// `numRuns` with no guard clause inside the property, so the witness floor is
// that number exactly rather than a measured fraction of it (test-support
// witness, `atLeast`). A property that stopped asserting reads as 0.
const RUNS = 200;

describe("M9 grounding — placeRef (KI-81)", () => {
  // The approval door (`parseApprovedCommands`, apps/web) re-parses every posted
  // command through THIS schema and sends what comes back to the executor. So
  // "the schema carries the field" and "an approved plan keeps its grounding"
  // are one fact: a ref the parse strips is a stop that silently falls back to
  // whatever prose the model wrote, which is the bug KI-81 names.
  it("survives a BatchableCommand round-trip on AddActivity and UpdateActivity", () => {
    const add = BatchableCommand.parse({
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", placeRef: 3,
    });
    if (add.type !== "AddActivity") throw new Error("wrong type");
    expect(add.placeRef).toBe(3);

    const update = BatchableCommand.parse({
      type: "UpdateActivity", tripId: TRIP, activityId: A1, placeRef: 0,
    });
    if (update.type !== "UpdateActivity") throw new Error("wrong type");
    expect(update.placeRef).toBe(0);
  });

  // Free text is still a first-class way to say where something is — a user
  // typed it, nobody searched for it, and the geocoding fallback is what gives
  // it coordinates. Absent must therefore stay absent, not become a 0 that would
  // resolve to somebody's first search result.
  it("is absent, never defaulted, on a command that cites nothing", () => {
    const add = BatchableCommand.parse({
      type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den",
      location: { name: "the place my sister mentioned" },
    });
    if (add.type !== "AddActivity") throw new Error("wrong type");
    expect(add.placeRef).toBeUndefined();
    expect("placeRef" in add).toBe(false);
  });

  // A ref is an INDEX into a list the server holds. Anything that is not a
  // whole, countable position is a model inventing one, and it is refused here
  // rather than three layers down where it would read as "no such candidate".
  it("accepts every whole non-negative index and refuses anything that is not one", () => {
    let accepted = 0;
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (ref) => {
        const parsed = BatchableCommand.parse({
          type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", placeRef: ref,
        });
        if (parsed.type !== "AddActivity") throw new Error("wrong type");
        expect(parsed.placeRef).toBe(ref);
        accepted += 1;
      }),
      { numRuns: RUNS },
    );
    expect(accepted, "the acceptance property asserted nothing").toBe(RUNS);

    let refused = 0;
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10_000, max: -1 }),
          fc.double({ min: 0.01, max: 10_000, noInteger: true, noNaN: true }),
        ),
        (ref) => {
          expect(() =>
            BatchableCommand.parse({
              type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", placeRef: ref,
            }),
          ).toThrow();
          refused += 1;
        },
      ),
      { numRuns: RUNS },
    );
    expect(refused, "the rejection property asserted nothing").toBe(RUNS);
  });

  // Clearing a location is `location: null`; there is no such thing as a null
  // ref, and a string ref is the model handing back the candidate's name.
  it("refuses a null or non-numeric ref on either command", () => {
    for (const ref of [null, "2", "Bar Trench", true, {}]) {
      expect(() =>
        BatchableCommand.parse({ type: "AddActivity", tripId: TRIP, activityId: A1, title: "Den", placeRef: ref }),
      ).toThrow();
      expect(() =>
        BatchableCommand.parse({ type: "UpdateActivity", tripId: TRIP, activityId: A1, placeRef: ref }),
      ).toThrow();
    }
  });

  // **The ref is transport, and the event log is forever.** `ActivityPayloadFields`
  // is what gets written to jsonb, and a candidate number means nothing once the
  // turn that produced the candidates is gone — replaying it would cite a list
  // no longer in existence. The server resolves the ref into `location` before
  // the domain ever sees the command, so this asserts the shape stays that way:
  // the two payloads have no `placeRef`, and one stored with the key anyway is
  // dropped on read rather than carried.
  it("never reaches the stored event payloads", () => {
    expect(Object.keys(ActivityAddedV1.shape.payload.shape)).not.toContain("placeRef");
    expect(Object.keys(ActivityUpdatedV1.shape.payload.shape)).not.toContain("placeRef");

    const stored = TripEvent.parse({
      type: "ActivityAdded",
      version: 1,
      payload: {
        tripId: TRIP, activityId: A1, dayId: null, title: "Den",
        timeWindow: null, location: null, notes: null, placeRef: 3,
      },
    });
    if (stored.type !== "ActivityAdded") throw new Error("wrong type");
    expect("placeRef" in stored.payload).toBe(false);
  });
});
