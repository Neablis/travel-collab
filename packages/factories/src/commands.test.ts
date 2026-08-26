import { randomUUID } from "node:crypto";
import { TripCommand } from "@tc/contracts";
import { describe, expect, it } from "vitest";
import { commandsFor } from "./commands";
import { scenarios } from "./scenarios";

type ScenarioName = keyof typeof scenarios;
const scenarioNames = Object.keys(scenarios) as ScenarioName[];

// Regression guard for KI-37: `commandsFor` built each activity's time window
// with `0${9 + i}:00`, which only zero-pads correctly for the day's first
// activity. Every scenario with activitiesPerDay >= 2 emitted "010:00" for its
// second activity — five characters, rejected by the contract's HH:MM regex,
// so the command came back `invalid-command` instead of a usable window.
describe("commandsFor time windows", () => {
  it.each(scenarioNames)("emits only contract-valid commands for %s", (scenario) => {
    const tripId = randomUUID();
    for (const command of commandsFor(scenario, tripId)) {
      const parsed = TripCommand.safeParse(command);
      expect(parsed.success, `${scenario}: ${JSON.stringify(command)} -> ${parsed.error?.message}`).toBe(true);
    }
  });

  it("zero-pads the second (and later) activity of a day to HH:MM", () => {
    const tripId = randomUUID();
    const windows = commandsFor("threeDayTrip", tripId)
      .filter((c) => c.type === "AddActivity")
      .map((c) => (c as Extract<TripCommand, { type: "AddActivity" }>).timeWindow);

    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(window).toBeDefined();
      expect(window!.start).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(window!.end).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(window!.start < window!.end).toBe(true);
    }
    expect(windows[0]).toEqual({ start: "09:00", end: "10:00" });
    expect(windows[1]).toEqual({ start: "10:00", end: "11:00" });
  });
});
