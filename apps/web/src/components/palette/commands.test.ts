import { describe, expect, it, vi } from "vitest";
import { activityFactory, tripDetailFixture, uuidFrom } from "@tc/factories";
import {
  addDayCommand,
  askCommand,
  editStopCommands,
  goToDayCommands,
  goToStopCommands,
  lensCommands,
  moveDayCommands,
  moveStopCommands,
  newStopCommand,
  newTripCommand,
  placeCommands,
  removeDayCommands,
  removeStopCommands,
  tripSettingsCommands,
  tripTargets,
  undoRedoCommands,
} from "./commands";
import { paletteLevel, pathText } from "./grammar";
import { rankPalette } from "./match";

// ADR-068 §2: a command runs the page's own function. Where the action takes
// no argument the command holds the very same reference; where it takes one,
// running the command calls the function it was given with that argument and
// nothing else. A builder that grew behaviour of its own fails here.
describe("palette commands hold the page's own actions", () => {
  it("Add › Stop, Add › Day, Ask and Add › Trip are the function they were given", () => {
    const openNewStop = vi.fn();
    const addDay = vi.fn();
    const openAssistant = vi.fn();
    const startNewTrip = vi.fn();
    expect(newStopCommand(openNewStop).run).toBe(openNewStop);
    expect(addDayCommand(addDay).run).toBe(addDay);
    expect(askCommand(openAssistant).run).toBe(openAssistant);
    expect(newTripCommand(startNewTrip).run).toBe(startNewTrip);
    expect([newStopCommand(openNewStop), addDayCommand(addDay), newTripCommand(startNewTrip)].map((c) => pathText(c))).toEqual(["Add › Stop", "Add › Day", "Add › Trip"]);
  });

  it("undo and redo are the History controls' handlers, offered only when each can run", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const both = undoRedoCommands({ canUndo: true, canRedo: true, onUndo, onRedo });
    expect(both.map((c) => c.run)).toEqual([onUndo, onRedo]);
    expect(both[0]?.run).toBe(onUndo);
    expect(undoRedoCommands({ canUndo: false, canRedo: true, onUndo, onRedo }).map((c) => c.id)).toEqual(["redo"]);
    expect(undoRedoCommands({ canUndo: false, canRedo: false, onUndo, onRedo })).toEqual([]);
  });

  it("each lens is the lens switcher's setView, with that lens", () => {
    const setView = vi.fn();
    const commands = lensCommands(setView);
    commands.find((c) => c.target?.label === "Calendar")?.run();
    expect(setView).toHaveBeenCalledExactlyOnceWith("Calendar");
    expect(commands.map((c) => pathText(c))).toEqual(["Go to › View › Overview", "Go to › View › Plan", "Go to › View › Calendar", "Go to › View › Map"]);
  });

  it("Edit › Trip is the header's one opener, at its top and at each section; Sharing only for who may share", () => {
    const openSettings = vi.fn();
    const commands = tripSettingsCommands(openSettings, true);
    for (const command of commands) command.run();
    expect(commands.map((c) => pathText(c))).toEqual(["Edit › Trip › Settings", "Edit › Trip › People", "Edit › Trip › Cover", "Edit › Trip › Sharing"]);
    expect(openSettings.mock.calls).toEqual([[null], ["people"], ["cover"], ["share"]]);
    expect(tripSettingsCommands(openSettings, false).map((c) => c.id)).toEqual(["settings", "people", "cover"]);
  });

  it("places go where the app's own links go, trips in the order given", () => {
    const go = vi.fn();
    const commands = placeCommands(go, [
      { tripId: "t1", name: "Kyoto" },
      { tripId: "t2", name: "Lisbon" },
    ]);
    for (const command of commands) command.run();
    expect(go.mock.calls.flat()).toEqual(["/", "/playbooks", "/account", "/trips/t1", "/trips/t2"]);
    expect(commands.filter((c) => c.type === "Trip").map((c) => c.order)).toEqual([0, 1]);
  });
});

// A trip of two days and a parked stop: Day 1 in Ostia then Rome, its stops
// listed out of time order; Day 2 with no city; two stops called Ramen.
const DAY_1 = uuidFrom(101);
const DAY_2 = uuidFrom(102);
const place = (city: string) => ({ name: city, lat: 0, lng: 0, city });
const late = activityFactory.build({ activityId: uuidFrom(1), title: "Ramen", timeWindow: { start: "19:00", end: "20:00" }, location: place("Ostia") });
const early = activityFactory.build({ activityId: uuidFrom(2), title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" }, location: place("Rome") });
const untimed = activityFactory.build({ activityId: uuidFrom(3), title: "  ", timeWindow: null });
const other = activityFactory.build({ activityId: uuidFrom(4), title: "Ramen", timeWindow: { start: "12:00", end: "13:00" } });
const parked = activityFactory.build({ activityId: uuidFrom(5), title: "Gelato", timeWindow: null });
const trip = tripDetailFixture({
  days: [
    { dayId: DAY_1, activityIds: [untimed.activityId, late.activityId, early.activityId], date: null, costSubtotal: 0 },
    { dayId: DAY_2, activityIds: [other.activityId], date: null, costSubtotal: 0 },
  ],
  backlog: [parked.activityId],
  activities: Object.fromEntries([late, early, untimed, other, parked].map((a) => [a.activityId, a])),
});
const nowhere = { focusedActivityId: null, focusedDayId: null, selectedDayId: null };

describe("a trip's days and stops, as the palette names and orders them (ADR-069 §4, §5)", () => {
  it("names a day by its number and its cities, and a stop by its title, its day only where two share one", () => {
    const { days, stops } = tripTargets(trip, nowhere);
    expect(days.map((d) => d.label)).toEqual(["Day 1 · Ostia · Rome", "Day 2"]);
    expect(stops.map((s) => s.label)).toEqual(["Colosseum", "Ramen · Day 1", "Untitled stop", "Ramen · Day 2", "Gelato"]);
    expect(stops.map((s) => s.dayId)).toEqual([DAY_1, DAY_1, DAY_1, DAY_2, null]);
  });

  it("puts the focused stop and day first, then the selected day and its stops, then the trip", () => {
    const { days, stops } = tripTargets(trip, { focusedActivityId: late.activityId, focusedDayId: DAY_1, selectedDayId: DAY_2 });
    expect(days.map((d) => d.nearness)).toEqual(["focused", "selected"]);
    expect(stops.map((s) => s.nearness)).toEqual(["trip", "focused", "trip", "selected", "trip"]);
  });
});

describe("a trip's day and stop commands run the page's own functions", () => {
  const { days, stops } = tripTargets(trip, nowhere);

  it("Go to › Day and Go to › Stop focus the thing; a parked stop is on no day to go to", () => {
    const focusDay = vi.fn();
    const focusActivity = vi.fn();
    for (const command of goToDayCommands(days, focusDay)) command.run();
    const toStops = goToStopCommands(stops, focusActivity);
    for (const command of toStops) command.run();
    expect(focusDay.mock.calls).toEqual([[DAY_1], [DAY_2]]);
    expect(focusActivity.mock.calls.flat()).toEqual([early, late, untimed, other].map((a) => a.activityId));
    expect(toStops.map((c) => c.target?.key)).not.toContain(parked.activityId);
  });

  it("Edit › Stop opens the editor, Remove › Stop and Remove › Day are the board's own removals", () => {
    const openEdit = vi.fn();
    const removeActivity = vi.fn();
    const removeDay = vi.fn();
    editStopCommands(stops, openEdit).at(-1)?.run();
    removeStopCommands(stops, removeActivity)[1]?.run();
    removeDayCommands(days, removeDay)[1]?.run();
    expect(openEdit).toHaveBeenCalledExactlyOnceWith(parked.activityId);
    expect(removeActivity).toHaveBeenCalledExactlyOnceWith(late.activityId);
    expect(removeDay).toHaveBeenCalledExactlyOnceWith(DAY_2);
    expect(removeDayCommands(days, removeDay).map((c) => pathText(c))).toEqual(["Remove › Day › Day 1 · Ostia · Rome", "Remove › Day › Day 2"]);
  });

  it("Move › Stop goes to every other day or the rack, by the board's moveActivity", () => {
    const moveActivity = vi.fn();
    const commands = moveStopCommands(stops, days, moveActivity);
    const ramen = commands.filter((c) => c.target?.key === late.activityId);
    expect(ramen.map((c) => pathText(c))).toEqual(["Move › Stop › Ramen · Day 1 › Day 2", "Move › Stop › Ramen · Day 1 › Unscheduled"]);
    expect(commands.filter((c) => c.target?.key === parked.activityId).map((c) => c.destination?.label)).toEqual(["Day 1 · Ostia · Rome", "Day 2"]);
    for (const command of ramen) command.run();
    expect(moveActivity.mock.calls).toEqual([
      [late.activityId, DAY_2],
      [late.activityId, null],
    ]);
  });

  it("Move › Day takes a day with stops to another day or a new one after the last, by the drag's moveDay", () => {
    const moveDay = vi.fn();
    const empty = { dayId: uuidFrom(103), activityIds: [], date: null, costSubtotal: 0 };
    const commands = moveDayCommands(tripTargets({ ...trip, days: [...trip.days, empty] }, nowhere).days, moveDay);
    expect(commands.map((c) => pathText(c))).toEqual([
      "Move › Day › Day 1 · Ostia · Rome › Day 2",
      "Move › Day › Day 1 · Ostia · Rome › Day 3",
      "Move › Day › Day 1 · Ostia · Rome › New day after Day 3",
      "Move › Day › Day 2 › Day 1 · Ostia · Rome",
      "Move › Day › Day 2 › Day 3",
      "Move › Day › Day 2 › New day after Day 3",
    ]);
    commands[2]?.run();
    commands[3]?.run();
    expect(moveDay.mock.calls).toEqual([
      [DAY_1, null],
      [DAY_2, DAY_1],
    ]);
  });
});

// The grammar reading what the builders produce: what someone drilling in or
// typing actually meets.
describe("the trip's commands in the palette", () => {
  const { days, stops } = tripTargets(trip, { focusedActivityId: null, focusedDayId: null, selectedDayId: DAY_2 });
  const commands = [...moveStopCommands(stops, days, vi.fn()), ...moveDayCommands(days, vi.fn()), ...goToStopCommands(stops, vi.fn())];

  it("drills Move › Stop to the stops nearest first, then by day and time, and a stop to its destinations in day order", () => {
    expect(paletteLevel(commands, ["Move", "Stop"])?.map((n) => n.label)).toEqual(["Ramen · Day 2", "Colosseum", "Ramen · Day 1", "Untitled stop", "Gelato"]);
    expect(paletteLevel(commands, ["Move", "Stop", early.activityId])?.map((n) => n.label)).toEqual(["Day 2", "Unscheduled"]);
  });

  it("finds a day by a city on it, and a stop by its title and where it goes", () => {
    expect(rankPalette(commands, "move ostia 2")[0]?.id).toBe(`leaf:move:day:${DAY_1}:${DAY_2}`);
    expect(rankPalette(commands, "move colosseum unsch").map((hit) => hit.id)).toEqual([`leaf:move:stop:${early.activityId}:unscheduled`]);
  });
});
