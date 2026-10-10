import { describe, expect, it } from "vitest";
import type { ActivityView, TripDetail } from "@tc/contracts";
import { activityFactory, locationFactory, tripDetailFixture } from "@tc/factories";
import { copyActivityCommand, copyCommands, resolveCopy } from "./copyActivity";
import { rackDropWindow } from "./rackDropWindow";

const DAY = "11111111-1111-4111-8111-111111111111";
const DAY_2 = "22222222-2222-4222-8222-222222222222";
const NEW_ID = "99999999-9999-4999-8999-999999999999";
const stop = activityFactory.build({
  title: "Tea ceremony",
  timeWindow: { start: "10:00", end: "11:00" },
  tags: ["ticketed"],
  cost: { amountMinor: 4500, currency: "USD" },
});
const trip = tripDetailFixture({ activities: { [stop.activityId]: stop } });

// Every field a stop can hold set, across the two kinds whose details exclude
// each other (a leg's mode and end, a pending stop's reason).
const leg = activityFactory.build({
  title: "Shinkansen",
  kind: "transit",
  mode: "train",
  timeWindow: { start: "08:00", end: "10:15" },
  location: locationFactory.build(),
  endLocation: locationFactory.build(),
  notes: "Car 7",
  anchors: [{ kind: "dayOfWeek", days: ["tue"] }],
  tags: ["ticketed"],
  cost: { amountMinor: 14_000, currency: "JPY" },
  bookedBy: "u-alice",
  participants: ["u-bob"],
});
const pending = activityFactory.build({
  title: "Onsen",
  kind: "pending",
  pendingReason: "book",
  timeWindow: { start: "18:00", end: "20:00" },
  location: locationFactory.build(),
  notes: "Ask the ryokan",
  anchors: [{ kind: "dateRange", from: "2027-05-03", to: "2027-05-05" }],
  tags: ["outdoors"],
  cost: { amountMinor: 2_500, currency: "JPY" },
  bookedBy: "u-bob",
  participants: ["u-alice", "u-bob"],
});

// M41 D7: an Option/Alt-drag drops a copy. A copy that lost a field would be a
// different stop, so the whole stop is what it carries — every field the stop
// has, read off the stop itself, so a field added later is checked too.
describe("copyActivityCommand", () => {
  it.each([leg, pending])("adds a new stop with every field of $title, on the day it was dropped on", (original: ActivityView) => {
    const { activityId: _id, ...fields } = original;
    void _id;
    // A field the stop leaves empty is omitted from the command (`null` → absent).
    const carried = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ?? undefined]));
    const own = tripDetailFixture({ activities: { [original.activityId]: original } });

    expect(copyActivityCommand(own, original.activityId, NEW_ID, { dayId: DAY })).toEqual({
      ...carried,
      type: "AddActivity",
      tripId: own.tripId,
      activityId: NEW_ID,
      dayId: DAY,
    });
  });

  it("takes the time the drop named, and none on the rack", () => {
    expect(copyActivityCommand(trip, stop.activityId, NEW_ID, { dayId: DAY, timeWindow: { start: "14:00", end: "15:00" } })?.timeWindow).toEqual({
      start: "14:00",
      end: "15:00",
    });
    expect(copyActivityCommand(trip, stop.activityId, NEW_ID, { dayId: null, timeWindow: null })).toEqual(
      expect.objectContaining({ dayId: undefined, timeWindow: undefined }),
    );
  });
});

// PR 396 review: a copy's destination, read from the same drop targets a move
// reads (`resolveDrop`), but never "nothing changes" — a copy onto the stop's
// own slot is still a second stop.
describe("resolveCopy", () => {
  const breakfast = activityFactory.build({ title: "Breakfast", timeWindow: { start: "08:00", end: "09:00" } });
  const museum = activityFactory.build({ title: "Museum", timeWindow: { start: "10:00", end: "12:00" } });
  const untimed = activityFactory.build({ title: "Souvenirs", timeWindow: null });
  const parked = activityFactory.build({ title: "Gelato", timeWindow: null });
  const plan: TripDetail = tripDetailFixture({
    days: [
      { dayId: DAY, date: null, activityIds: [breakfast.activityId, museum.activityId, untimed.activityId], costSubtotal: 0 },
      { dayId: DAY_2, date: null, activityIds: [], costSubtotal: 0 },
    ],
    backlog: [parked.activityId],
    activities: Object.fromEntries([breakfast, museum, untimed, parked].map((a) => [a.activityId, a])),
  });
  const from = (a: ActivityView) => ({ activityId: a.activityId });

  it("copies onto the stop's own time on its own day", () => {
    expect(resolveCopy(plan, from(museum), { dayId: DAY, riverWindow: { start: "10:00", end: "12:00" } })).toEqual({
      activityId: museum.activityId,
      dayId: DAY,
      timeWindow: { start: "10:00", end: "12:00" },
      position: null,
    });
  });

  it("copies onto the stop's own column, keeping its time", () => {
    expect(resolveCopy(plan, from(museum), { dayId: DAY })).toEqual({
      activityId: museum.activityId,
      dayId: DAY,
      timeWindow: undefined,
      position: null,
    });
  });

  it("copies an untimed stop shown under its day onto that day's rack section, untimed — and onto No day, parked", () => {
    expect(resolveCopy(plan, from(untimed), { rack: true })).toEqual({ activityId: untimed.activityId, dayId: DAY, timeWindow: null, position: null });
    expect(resolveCopy(plan, from(untimed), { rack: true, noDay: true })).toEqual({
      activityId: untimed.activityId,
      dayId: null,
      timeWindow: null,
      position: null,
    });
  });

  it("gives a parked stop's copy on a column the fitted time a move there gets", () => {
    // The window a move of it to the end of that day is given.
    const fitted = rackDropWindow(plan, parked.activityId, DAY, 3);
    expect(fitted).not.toBeNull();
    expect(resolveCopy(plan, from(parked), { dayId: DAY })).toEqual({ activityId: parked.activityId, dayId: DAY, timeWindow: fitted, position: null });
  });

  it("places a copy on a river before the first stop that starts later", () => {
    expect(resolveCopy(plan, from(museum), { dayId: DAY, riverWindow: { start: "07:00", end: "09:00" } })?.position).toBe(0);
    expect(resolveCopy(plan, from(museum), { dayId: DAY, riverWindow: { start: "09:00", end: "10:00" } })?.position).toBe(1);
    expect(resolveCopy(plan, from(breakfast), { dayId: DAY, riverWindow: { start: "13:00", end: "14:00" } })?.position).toBeNull();
  });
});

// PR 396 review: `AddActivity` appends, so a copy that belongs earlier on its
// day by the clock is moved there — in the same batch, one History entry.
describe("copyCommands", () => {
  const later = activityFactory.build({ title: "Dinner", timeWindow: { start: "18:00", end: "19:00" } });
  const plan = tripDetailFixture({
    days: [{ dayId: DAY, date: null, activityIds: [later.activityId], costSubtotal: 0 }],
    activities: { [stop.activityId]: stop, [later.activityId]: later },
    backlog: [stop.activityId],
  });

  it("adds the copy, then moves it before the later stops when it starts earlier", () => {
    const commands = copyCommands(plan, { activityId: stop.activityId, dayId: DAY, timeWindow: { start: "08:00", end: "09:00" }, position: 0 }, NEW_ID);

    expect(commands.map((c) => c.type)).toEqual(["AddActivity", "MoveActivity"]);
    expect(commands[0]).toEqual(expect.objectContaining({ activityId: NEW_ID, dayId: DAY, timeWindow: { start: "08:00", end: "09:00" } }));
    expect(commands[1]).toEqual({ type: "MoveActivity", tripId: plan.tripId, activityId: NEW_ID, toDayId: DAY, position: 0 });
  });

  it("only adds when appending already keeps the clock's order", () => {
    expect(copyCommands(plan, { activityId: stop.activityId, dayId: DAY, timeWindow: { start: "20:00", end: "21:00" }, position: null }, NEW_ID)).toEqual([
      expect.objectContaining({ type: "AddActivity", activityId: NEW_ID }),
    ]);
  });
});
