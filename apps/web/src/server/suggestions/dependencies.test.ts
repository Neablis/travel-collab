import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { witness } from "../../test-support/witness";
import { createdIds, dependsOn, referencedIds } from "./dependencies";

const tripId = uuidFrom(1, 900);
const day = uuidFrom(2, 900);
const stop = uuidFrom(3, 900);
const existingStop = uuidFrom(4, 900);

describe("createdIds / referencedIds", () => {
  it("reads a created day, a created stop and the days SetTripDates appends", () => {
    const extra = uuidFrom(5, 900);
    expect(createdIds([{ type: "AddDay", tripId, dayId: day }])).toEqual(new Set([day]));
    expect(createdIds([{ type: "AddActivity", tripId, activityId: stop, dayId: day, title: "Tea" }])).toEqual(
      new Set([stop]),
    );
    expect(
      createdIds([{ type: "SetTripDates", tripId, startDate: null, endDate: null, newDayIds: [extra] }]),
    ).toEqual(new Set([extra]));
  });

  it("reads every day and stop a command targets, and nothing a trip-level command names", () => {
    expect(
      referencedIds([
        { type: "AddActivity", tripId, activityId: stop, dayId: day, title: "Tea" },
        { type: "MoveActivity", tripId, activityId: existingStop, toDayId: day, position: 0 },
        { type: "SetTripName", tripId, name: "Kyoto" },
      ]),
    ).toEqual(new Set([day, existingStop]));
    expect(referencedIds([{ type: "MoveActivity", tripId, activityId: stop, toDayId: null, position: 0 }])).toEqual(
      new Set([stop]),
    );
  });
});

describe("dependsOn", () => {
  it("makes a stop added to a suggested day depend on the unit that added the day", () => {
    const units: BatchableCommand[][] = [
      [{ type: "AddDay", tripId, dayId: day }],
      [{ type: "SetTripName", tripId, name: "Kyoto" }],
      [{ type: "AddActivity", tripId, activityId: stop, dayId: day, title: "Tea" }],
      [{ type: "UpdateActivity", tripId, activityId: stop, title: "Matcha" }],
    ];
    expect(dependsOn(units)).toEqual([[], [], [0], [2]]);
  });

  it("never makes a unit depend on a LATER unit that creates what it names", () => {
    const units: BatchableCommand[][] = [
      [{ type: "RemoveActivity", tripId, activityId: stop }],
      [{ type: "AddActivity", tripId, activityId: stop, title: "Tea" }],
    ];
    expect(dependsOn(units)).toEqual([[], []]);
  });
});

// A small id pool, so generated units collide on ids often enough that
// "independent" is a real claim and not the trivially-true common case.
const dayIds = [0, 1, 2, 3].map((i) => uuidFrom(i, 901));
const stopIds = [0, 1, 2, 3].map((i) => uuidFrom(i, 902));
const anyDay = fc.constantFrom(...dayIds);
const anyStop = fc.constantFrom(...stopIds);

const command: fc.Arbitrary<BatchableCommand> = fc.oneof(
  anyDay.map((dayId): BatchableCommand => ({ type: "AddDay", tripId, dayId })),
  anyDay.map((dayId): BatchableCommand => ({ type: "RemoveDay", tripId, dayId })),
  fc.subarray(dayIds).map(
    (newDayIds): BatchableCommand => ({ type: "SetTripDates", tripId, startDate: null, endDate: null, newDayIds }),
  ),
  fc.record({ activityId: anyStop, dayId: fc.option(anyDay, { nil: undefined }) }).map(
    ({ activityId, dayId }): BatchableCommand => ({ type: "AddActivity", tripId, activityId, dayId, title: "Stop" }),
  ),
  anyStop.map((activityId): BatchableCommand => ({ type: "UpdateActivity", tripId, activityId, title: "Renamed" })),
  fc.record({ activityId: anyStop, toDayId: fc.option(anyDay, { nil: null }) }).map(
    ({ activityId, toDayId }): BatchableCommand => ({ type: "MoveActivity", tripId, activityId, toDayId, position: 0 }),
  ),
  anyStop.map((activityId): BatchableCommand => ({ type: "RemoveActivity", tripId, activityId })),
  fc.constant<BatchableCommand>({ type: "SetTripName", tripId, name: "Kyoto" }),
);
const units = fc.array(fc.array(command, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 6 });

describe("dependsOn — properties", () => {
  it("an independent unit never depends on anything, and a dependency is always an earlier unit", () => {
    const w = witness("independent unit");
    fc.assert(
      fc.property(units, (draft) => {
        const deps = dependsOn(draft);
        expect(deps).toHaveLength(draft.length);
        const createdBefore = new Set<string>();
        draft.forEach((unit, i) => {
          for (const j of deps[i]!) expect(j).toBeLessThan(i);
          const independent = [...referencedIds(unit)].every((id) => !createdBefore.has(id));
          if (independent) {
            // Ticks only where an earlier unit created something: with nothing
            // created before it, "depends on nothing" is true of any answer.
            if (createdBefore.size > 0) w.tick();
            expect(deps[i]).toEqual([]);
          }
          for (const id of createdIds(unit)) createdBefore.add(id);
        });
      }),
    );
    w.atLeast(44); // observed 89-139 non-trivial independent units over 12 runs
  });
});
