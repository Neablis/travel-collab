import { randomUUID } from "node:crypto";
import { TripCommand } from "@tc/contracts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commandsFor } from "./commands";
import { scenarios } from "./scenarios";

type ScenarioName = keyof typeof scenarios;
const scenarioNames = Object.keys(scenarios) as ScenarioName[];

// `commandsFor`'s default startDate is `new Date() + 10 days` (commands.ts),
// and every differential below generates two streams from two independent
// clock reads. If the UTC date rolls over between those two calls the streams
// differ in `SetTripDates.startDate` alone and the comparison fails — a real
// once-a-day flake, not a hypothetical, and exactly the "fails in a different
// place between runs" signature AGENTS.md says not to retry through. Pinning
// the clock removes the window without weakening the differential, which is
// about the *defaults* and so cannot just pass an explicit startDate:
// `commandsForPreKi41` is a verbatim copy of the pre-refactor generator and
// takes no startDate option to pass.
beforeAll(() => {
  vi.useFakeTimers({ now: new Date("2026-06-15T12:00:00.000Z") });
});
afterAll(() => {
  vi.useRealTimers();
});

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

// ---------------------------------------------------------------------------
// KI-41: `commandsFor` had no override surface, so it invented every value it
// needed from the loop index. These are the guards on the surface that replaced
// that, and on the differential claim that adding it changed no default.
// ---------------------------------------------------------------------------

/**
 * A verbatim inline copy of the PRE-KI-41 implementation (`packages/factories/
 * src/commands.ts` at the commit before the refactor), reduced only by deleting
 * its comments. It exists so "the defaults are unchanged" is a *differential*
 * against the code that actually shipped, not a restatement of the new code.
 */
function commandsForPreKi41(
  scenario: ScenarioName,
  tripId: string,
  options: { dayCount?: number } = {},
): TripCommand[] {
  const commands: TripCommand[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (base: Date, n: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d;
  };

  const dayCounts: Record<ScenarioName, number> = {
    emptyTrip: 0,
    threeDayTrip: 3,
    overBudgetTrip: 2,
    overlappingDay: 1,
    unscheduledHeavy: 2,
    mappedTrip: options.dayCount ?? 5,
    ungeocodedTrip: 1,
  };
  const activitiesPerDay: Record<ScenarioName, number> = {
    emptyTrip: 0,
    threeDayTrip: 2,
    overBudgetTrip: 2,
    overlappingDay: 2,
    unscheduledHeavy: 1,
    mappedTrip: 1,
    ungeocodedTrip: 2,
  };
  const located = scenario === "threeDayTrip" || scenario === "unscheduledHeavy" || scenario === "mappedTrip";
  const costed = scenario === "threeDayTrip" || scenario === "overBudgetTrip";
  const unscheduledCount = scenario === "unscheduledHeavy" ? 5 : 0;

  const dayCount = dayCounts[scenario];
  const start = addDays(new Date(), 10);
  const end = addDays(start, Math.max(dayCount - 1, 0));
  const newDayIds = Array.from({ length: dayCount }, () => randomUUID());

  if (dayCount > 0) {
    commands.push({ type: "SetTripDates", tripId, startDate: iso(start), endDate: iso(end), newDayIds });
  }

  if (scenario === "overBudgetTrip") {
    commands.push({ type: "SetTripBudget", tripId, budget: { amountMinor: 1000, currency: "USD" } });
  }

  if (scenario === "mappedTrip") {
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
      const activityId = randomUUID();
      commands.push({
        type: "AddActivity",
        tripId,
        activityId,
        title: `Stop on day ${dayIndex + 1}`,
        timeWindow: { start: "09:00", end: "10:00" },
        location: {
          name: `Place ${dayIndex + 1}`,
          city: `City ${dayIndex + 1}`,
          lat: 35 + dayIndex * 0.4,
          lng: 139 + dayIndex * 0.4,
          countryCode: "JP",
        },
      });
      commands.push({ type: "MoveActivity", tripId, activityId, toDayId: newDayIds[dayIndex]!, position: 0 });
    }
    return commands;
  }

  const WINDOW_MINUTES = 60;
  const FIRST_START_MINUTES = 9 * 60;
  const LAST_START_MINUTES = 22 * 60;
  const staggerMinutes = scenario === "overlappingDay" ? 30 : 60;
  const hhmm = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const timeWindowFor = (i: number) => {
    const startMinutes = Math.min(FIRST_START_MINUTES + i * staggerMinutes, LAST_START_MINUTES);
    return { start: hhmm(startMinutes), end: hhmm(startMinutes + WINDOW_MINUTES) };
  };

  let locationIndex = 0;
  const realLocations = [
    { name: "Colosseum, Rome, Italy", city: "Rome", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
    { name: "Fushimi Inari Taisha, Kyoto, Japan", city: "Kyoto", lat: 34.9671, lng: 135.7727, countryCode: "JP" },
    { name: "Sagrada Familia, Barcelona, Spain", city: "Barcelona", lat: 41.4036, lng: 2.1744, countryCode: "ES" },
  ];

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const dayId = newDayIds[dayIndex]!;
    for (let i = 0; i < activitiesPerDay[scenario]; i++) {
      const activityId = randomUUID();
      commands.push({
        type: "AddActivity",
        tripId,
        activityId,
        title: `Stop ${dayIndex + 1}.${i + 1}`,
        timeWindow: timeWindowFor(i),
        location: located ? realLocations[locationIndex++ % realLocations.length] : undefined,
        cost: costed ? { amountMinor: 2500 + i * 1100, currency: "USD" } : undefined,
      });
      commands.push({ type: "MoveActivity", tripId, activityId, toDayId: dayId, position: i });
    }
  }

  for (let i = 0; i < unscheduledCount; i++) {
    commands.push({
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      title: `Unscheduled stop ${i + 1}`,
      location: located ? realLocations[locationIndex++ % realLocations.length] : undefined,
    });
  }

  return commands;
}

/**
 * `commandsFor` mints fresh `randomUUID()`s for every day and activity, so two
 * runs can never be compared literally. Every id is replaced with a positional
 * token (`dayId#0`, `activityId#3`) — which also *proves* the id wiring, since
 * a `MoveActivity.toDayId` pointing at the wrong day would tokenize
 * differently. `JSON.parse(JSON.stringify(...))` also normalizes an
 * `undefined`-valued key against an absent one, which is the only textual
 * difference the refactor introduces (the old `mappedTrip` branch omitted
 * `cost` entirely; the unified path sets it to `undefined`, and `undefined` is
 * dropped on the wire by `JSON.stringify` in every real consumer).
 */
function tokenizeIds(commands: TripCommand[]): unknown[] {
  const tokens = new Map<string, string>();
  const token = (kind: string, id: string) => {
    if (!tokens.has(id)) tokens.set(id, `${kind}#${tokens.size}`);
    return tokens.get(id)!;
  };
  return commands.map((command) => {
    const clone = JSON.parse(JSON.stringify(command)) as Record<string, unknown>;
    if (typeof clone.activityId === "string") clone.activityId = token("activityId", clone.activityId);
    if (typeof clone.toDayId === "string") clone.toDayId = token("dayId", clone.toDayId);
    if (Array.isArray(clone.newDayIds)) clone.newDayIds = clone.newDayIds.map((id) => token("dayId", String(id)));
    return clone;
  });
}

describe("commandsFor defaults are byte-identical to the pre-KI-41 generator", () => {
  it.each(scenarioNames)("%s emits the same command stream it always did", (scenario) => {
    const tripId = randomUUID();
    expect(tokenizeIds(commandsFor(scenario, tripId))).toEqual(tokenizeIds(commandsForPreKi41(scenario, tripId)));
  });

  it("mappedTrip's dayCount option still drives the same per-day stream", () => {
    const tripId = randomUUID();
    for (const dayCount of [1, 5, 12]) {
      expect(tokenizeIds(commandsFor("mappedTrip", tripId, { dayCount })), `dayCount ${dayCount}`).toEqual(
        tokenizeIds(commandsForPreKi41("mappedTrip", tripId, { dayCount })),
      );
    }
  });

  it("is not a tautology: the differential fails when a default actually moves", () => {
    const tripId = randomUUID();
    const moved = commandsFor("threeDayTrip", tripId, {
      timeWindows: [
        { start: "14:00", end: "15:00" },
        { start: "16:00", end: "17:00" },
      ],
    });
    expect(tokenizeIds(moved)).not.toEqual(tokenizeIds(commandsForPreKi41("threeDayTrip", tripId)));
  });
});

describe("commandsFor override surface (KI-41)", () => {
  const addActivities = (commands: TripCommand[]) =>
    commands.filter((c): c is Extract<TripCommand, { type: "AddActivity" }> => c.type === "AddActivity");

  it("lets a caller state its own time windows instead of having them invented from `i`", () => {
    const windows = [
      { start: "14:00", end: "15:30" },
      { start: "20:15", end: "21:45" },
    ];
    const got = addActivities(commandsFor("threeDayTrip", randomUUID(), { timeWindows: windows })).map(
      (c) => c.timeWindow,
    );
    expect(got).toEqual([windows[0], windows[1], windows[0], windows[1], windows[0], windows[1]]);
  });

  it("takes dayCount, activitiesPerDay and unscheduledCount", () => {
    const commands = commandsFor("threeDayTrip", randomUUID(), {
      dayCount: 2,
      activitiesPerDay: 3,
      unscheduledCount: 4,
      timeWindows: [
        { start: "08:00", end: "09:00" },
        { start: "12:00", end: "13:00" },
        { start: "18:00", end: "19:00" },
      ],
    });
    const dates = commands.filter(
      (c): c is Extract<TripCommand, { type: "SetTripDates" }> => c.type === "SetTripDates",
    );
    expect(dates).toHaveLength(1);
    expect(dates[0]!.newDayIds).toHaveLength(2);
    expect(commands.filter((c) => c.type === "MoveActivity")).toHaveLength(6);
    expect(addActivities(commands)).toHaveLength(10);
    expect(addActivities(commands).slice(6).map((c) => c.title)).toEqual([
      "Unscheduled stop 1",
      "Unscheduled stop 2",
      "Unscheduled stop 3",
      "Unscheduled stop 4",
    ]);
  });

  it("takes startDate, and derives endDate from it rather than the wall clock", () => {
    const commands = commandsFor("threeDayTrip", randomUUID(), { startDate: "2027-02-27" });
    expect(commands[0]).toMatchObject({ type: "SetTripDates", startDate: "2027-02-27", endDate: "2027-03-01" });
  });

  it("takes budget, costs and locations", () => {
    const commands = commandsFor("threeDayTrip", randomUUID(), {
      dayCount: 1,
      budget: { amountMinor: 42, currency: "EUR" },
      costs: [{ amountMinor: 7, currency: "EUR" }, undefined],
      locations: [{ name: "Somewhere", lat: 1, lng: 2 }],
    });
    expect(commands.filter((c) => c.type === "SetTripBudget")).toEqual([
      { type: "SetTripBudget", tripId: expect.any(String), budget: { amountMinor: 42, currency: "EUR" } },
    ]);
    expect(addActivities(commands).map((c) => c.cost)).toEqual([{ amountMinor: 7, currency: "EUR" }, undefined]);
    expect(addActivities(commands).map((c) => c.location?.name)).toEqual(["Somewhere", "Somewhere"]);
  });

  it("takes title and unscheduledTitle", () => {
    const commands = commandsFor("unscheduledHeavy", randomUUID(), {
      dayCount: 1,
      unscheduledCount: 1,
      title: (d, i) => `custom ${d}/${i}`,
      unscheduledTitle: (i) => `backlog ${i}`,
    });
    expect(addActivities(commands).map((c) => c.title)).toEqual(["custom 0/0", "backlog 0"]);
  });

  it("ignores an explicitly-undefined override rather than letting it clobber a default", () => {
    const tripId = randomUUID();
    expect(tokenizeIds(commandsFor("threeDayTrip", tripId, { dayCount: undefined, timeWindows: undefined }))).toEqual(
      tokenizeIds(commandsFor("threeDayTrip", tripId)),
    );
  });

  it("still produces only contract-valid commands under overrides", () => {
    const commands = commandsFor("overBudgetTrip", randomUUID(), {
      dayCount: 4,
      activitiesPerDay: 3,
      unscheduledCount: 2,
      startDate: "2030-12-30",
      timeWindows: [
        { start: "00:00", end: "01:00" },
        { start: "12:00", end: "12:30" },
        { start: "23:00", end: "23:59" },
      ],
    });
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const parsed = TripCommand.safeParse(command);
      expect(parsed.success, `${JSON.stringify(command)} -> ${parsed.error?.message}`).toBe(true);
    }
  });

  it("fails loudly when asked for more activities per day than it has windows, instead of clamping", () => {
    // The deleted `Math.min(..., 22:00)` clamp silently emitted a duplicate
    // 22:00-23:00 window from a day's 14th activity onward — a plausible wrong
    // answer, the KI-38 species. Nothing invents a window now, so the same
    // over-ask is the caller's bug and says so.
    expect(() => commandsFor("threeDayTrip", randomUUID(), { activitiesPerDay: 3 })).toThrow(RangeError);
    expect(() => commandsFor("threeDayTrip", randomUUID(), { activitiesPerDay: 3 })).toThrow(
      /activitiesPerDay is 3 but only 2 timeWindow\(s\) were supplied/,
    );
    // 14 activities on a day is exactly what the clamp used to mangle. With
    // windows supplied it is now simply legal, and every window is distinct.
    const many = commandsFor("threeDayTrip", randomUUID(), {
      dayCount: 1,
      activitiesPerDay: 14,
      timeWindows: Array.from({ length: 14 }, (_, i) => ({
        start: `${String(9 + i).padStart(2, "0")}:00`,
        end: `${String(9 + i).padStart(2, "0")}:30`,
      })),
    });
    const starts = addActivities(many).map((c) => c.timeWindow!.start);
    expect(starts).toHaveLength(14);
    expect(new Set(starts).size).toBe(14);
  });
});
