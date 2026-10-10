import { describe, expect, it, vi } from "vitest";
import {
  askCommand,
  lensCommands,
  moveStopsCommands,
  newStopCommand,
  newTripCommand,
  placeCommands,
  tripSettingsCommands,
  undoRedoCommands,
} from "./commands";

// ADR-068 §2: a command runs the page's own function. Where the action takes
// no argument the command holds the very same reference; where it takes one,
// running the command calls the function it was given with that argument and
// nothing else. A builder that grew behaviour of its own fails here.
describe("palette commands hold the page's own actions", () => {
  it("New stop, Ask and New trip are the function they were given", () => {
    const openNewStop = vi.fn();
    const openAssistant = vi.fn();
    const startNewTrip = vi.fn();
    expect(newStopCommand(openNewStop).run).toBe(openNewStop);
    expect(askCommand(openAssistant).run).toBe(openAssistant);
    expect(newTripCommand(startNewTrip).run).toBe(startNewTrip);
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
    commands.find((c) => c.label === "Calendar")?.run();
    expect(setView).toHaveBeenCalledExactlyOnceWith("Calendar");
    expect(commands.map((c) => c.label)).toEqual(["Overview", "Plan", "Calendar", "Map"]);
  });

  it("Trip settings and Share are the header's one opener, at the top and at Share", () => {
    const openSettings = vi.fn();
    const [settings, share] = tripSettingsCommands(openSettings, true);
    settings?.run();
    share?.run();
    expect(openSettings.mock.calls).toEqual([[null], ["share"]]);
    expect(tripSettingsCommands(openSettings, false).map((c) => c.id)).toEqual(["settings"]);
  });

  it("places go where the app's own links go", () => {
    const go = vi.fn();
    for (const command of placeCommands(go, [{ tripId: "t1", name: "Kyoto" }])) command.run();
    expect(go.mock.calls.flat()).toEqual(["/", "/playbooks", "/account", "/trips/t1"]);
  });

  it("a block of stops moves by the drag's own move, to the destination named", () => {
    const move = vi.fn();
    const commands = moveStopsCommands({ id: "card", name: "Rome" }, [{ key: "1", label: "Day 2" }, { key: "after", label: "a new day after Day 3" }], move);
    expect(commands.map((c) => c.label)).toEqual(["Move Rome to Day 2", "Move Rome to a new day after Day 3"]);
    commands[1]?.run();
    commands[0]?.run();
    expect(move.mock.calls).toEqual([["after"], ["1"]]);
  });
});
