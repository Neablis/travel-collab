import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BatchableCommand } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { witness } from "../../test-support/witness";
import { dependsOn, effectOf, referencedIds, type UnitEffect } from "./dependencies";

const tripId = uuidFrom(1, 900);
const day = uuidFrom(2, 900);
const stop = uuidFrom(3, 900);
const existingStop = uuidFrom(4, 900);

const nothing: UnitEffect = { created: new Set(), changedDayCount: false };

describe("effectOf / referencedIds", () => {
  it("reads a created day and a created stop from the events, and a day count changed by adding or removing one", () => {
    expect(
      effectOf([
        { type: "DayAdded", version: 1, payload: { tripId, dayId: day } },
        { type: "TripStartDateSet", version: 1, payload: { tripId, startDate: "2027-05-01" } },
      ]),
    ).toEqual({ created: new Set([day]), changedDayCount: true });
    expect(effectOf([{ type: "DayRemoved", version: 1, payload: { tripId, dayId: day } }])).toEqual({
      created: new Set(),
      changedDayCount: true,
    });
    expect(effectOf([{ type: "TripNameSet", version: 1, payload: { tripId, name: "Kyoto" } }])).toEqual(nothing);
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
  const created = (...ids: string[]): UnitEffect => ({ created: new Set(ids), changedDayCount: false });

  it("makes a stop added to a suggested day depend on the unit that added the day", () => {
    const units = [
      { commands: [{ type: "AddDay", tripId, dayId: day }], effect: { ...created(day), changedDayCount: true } },
      { commands: [{ type: "SetTripName", tripId, name: "Kyoto" }], effect: nothing },
      { commands: [{ type: "AddActivity", tripId, activityId: stop, dayId: day, title: "Tea" }], effect: created(stop) },
      { commands: [{ type: "UpdateActivity", tripId, activityId: stop, title: "Matcha" }], effect: nothing },
    ] satisfies { commands: BatchableCommand[]; effect: UnitEffect }[];
    expect(dependsOn(units)).toEqual([[], [], [0], [2]]);
  });

  it("never makes a unit depend on a LATER unit that creates what it names", () => {
    const units = [
      { commands: [{ type: "RemoveActivity", tripId, activityId: stop }], effect: nothing },
      { commands: [{ type: "AddActivity", tripId, activityId: stop, title: "Tea" }], effect: created(stop) },
    ] satisfies { commands: BatchableCommand[]; effect: UnitEffect }[];
    expect(dependsOn(units)).toEqual([[], []]);
  });

  // The day count is what a range edit is decided against; a start-only change
  // and a unit that did not change the count are not parents of one.
  it("makes a range edit depend on every earlier unit that changed the day count, and on nothing else", () => {
    const range: BatchableCommand = { type: "SetTripDates", tripId, startDate: "2027-05-01", endDate: "2027-05-03", newDayIds: [] };
    const startOnly: BatchableCommand = { type: "SetTripDates", tripId, startDate: "2027-05-01", endDate: null, newDayIds: [] };
    const units = [
      { commands: [{ type: "RemoveDay", tripId, dayId: day }], effect: { created: new Set<string>(), changedDayCount: true } },
      { commands: [startOnly], effect: nothing },
      { commands: [{ type: "SetTripName", tripId, name: "Kyoto" }], effect: nothing },
      { commands: [range], effect: nothing },
      { commands: [startOnly], effect: nothing },
    ];
    expect(dependsOn(units)).toEqual([[], [], [], [0], []]);
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
  fc.record({ endDate: fc.constantFrom(null, "2027-05-03"), newDayIds: fc.subarray(dayIds) }).map(
    ({ endDate, newDayIds }): BatchableCommand => ({ type: "SetTripDates", tripId, startDate: "2027-05-01", endDate, newDayIds }),
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
// The effect is drawn on its own rather than derived from the commands: what a
// dry run creates is not a function of the commands' fields (W56), so the
// property must hold for any effect.
const effect: fc.Arbitrary<UnitEffect> = fc
  .record({ created: fc.subarray([...dayIds, ...stopIds], { maxLength: 2 }), changedDayCount: fc.boolean() })
  .map(({ created, changedDayCount }) => ({ created: new Set(created), changedDayCount }));
const units = fc.array(
  fc.record({ commands: fc.array(command, { minLength: 1, maxLength: 3 }), effect }),
  { minLength: 1, maxLength: 6 },
);

describe("dependsOn — properties", () => {
  it("an independent unit never depends on anything, and a dependency is always an earlier unit", () => {
    const w = witness("independent unit");
    fc.assert(
      fc.property(units, (draft) => {
        const deps = dependsOn(draft);
        expect(deps).toHaveLength(draft.length);
        const createdBefore = new Set<string>();
        let countChangedBefore = false;
        draft.forEach(({ commands, effect }, i) => {
          for (const j of deps[i]!) expect(j).toBeLessThan(i);
          const rangeEdit = commands.some((c) => c.type === "SetTripDates" && c.endDate !== null);
          const independent =
            [...referencedIds(commands)].every((id) => !createdBefore.has(id)) && !(rangeEdit && countChangedBefore);
          if (independent) {
            // Ticks only where an earlier unit did something a unit could build
            // on: with nothing before it, "depends on nothing" is true of any answer.
            if (createdBefore.size > 0 || countChangedBefore) w.tick();
            expect(deps[i]).toEqual([]);
          }
          for (const id of effect.created) createdBefore.add(id);
          countChangedBefore ||= effect.changedDayCount;
        });
      }),
    );
    w.atLeast(56); // observed 113-155 non-trivial independent units over 12 runs
  });
});
