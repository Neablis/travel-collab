import { randomUUID } from "node:crypto";
import type { Conflict, TripCommand, TripDetail } from "@tc/contracts";
import { decideTripCommand, detectConflicts, evolveTrip, hydrate, type TripState } from "@tc/domain";
import { describe, expect, it } from "vitest";
import { commandsFor } from "./commands";
import { scenarios } from "./scenarios";
import { tripDetailFactory } from "./trip";

type ScenarioName = keyof typeof scenarios;
const scenarioNames = Object.keys(scenarios) as ScenarioName[];
const otherScenarioNames = scenarioNames.filter((s) => s !== "overlappingDay");

// Replays a scenario's command stream the way the real write path does —
// decide → append events → evolve — so what comes out is the same TripState
// the server would hold. Asserting on time strings would only prove the
// factory agrees with itself; running the result through the domain's own
// `detectConflicts` proves the scenario means what its name says.
function stateFromCommands(scenario: ScenarioName, tripId: string): TripState {
  const ctx = { actorId: "dev-alice" };
  const create: TripCommand = { type: "CreateTrip", tripId, name: `${scenario} fixture`, forkedFrom: null };
  let state: TripState | null = null;
  for (const command of [create, ...commandsFor(scenario, tripId)]) {
    const decision = decideTripCommand(state, command, ctx);
    if (!decision.ok) {
      throw new Error(`${scenario}: ${command.type} rejected — ${decision.rejection.code}: ${decision.rejection.message}`);
    }
    for (const event of decision.events) state = evolveTrip(state, event);
  }
  if (state === null) throw new Error(`${scenario}: no state after replay`);
  return state;
}

const timeOverlaps = (conflicts: Conflict[]) => conflicts.filter((c) => c.kind === "time-overlap");

describe("commandsFor('overlappingDay') actually overlaps", () => {
  it("produces a real time-overlap conflict from the domain conflict engine", () => {
    const tripId = randomUUID();
    const state = stateFromCommands("overlappingDay", tripId);

    const overlaps = timeOverlaps(detectConflicts(state));
    expect(overlaps).toHaveLength(1);

    const [overlap] = overlaps;
    const [dayId] = state.days.map((d) => d.dayId);
    const [first, second] = state.days[0]!.activityIds;
    const [s1, s2] = [first!, second!].sort();
    expect(overlap).toEqual({
      id: `time-overlap:${dayId}:${s1}:${s2}`,
      kind: "time-overlap",
      severity: "warn",
      subjects: [s1, s2],
      description: `"Stop 1.1" and "Stop 1.2" overlap in time on the same day.`,
      resolutions: [
        "Change one activity's time window",
        "Move one activity to another day or the backlog",
      ],
    });
  });

  it("overlaps partially rather than identically — the interesting case, not the degenerate one", () => {
    const state = stateFromCommands("overlappingDay", randomUUID());
    const windows = state.days[0]!.activityIds.map((id) => state.activities[id]!.timeWindow);

    expect(windows).toEqual([
      { start: "09:00", end: "10:00" },
      { start: "09:30", end: "10:30" },
    ]);
    expect(windows[0]).not.toEqual(windows[1]);
  });
});

describe("every other scenario's command stream stays overlap-free", () => {
  // The negative half of the guard. These windows are back-to-back hourly ones
  // that touch at the boundary (09:00-10:00, then 10:00-11:00); `windowsOverlap`
  // is strict, so touching is not overlapping. If a future change widens the
  // default stagger's windows, or applies overlappingDay's half-hour stagger
  // package-wide, this goes red.
  it.each(otherScenarioNames)("%s produces no time-overlap conflict", (scenario) => {
    const state = stateFromCommands(scenario, randomUUID());
    expect(timeOverlaps(detectConflicts(state))).toEqual([]);
  });

  it("keeps every non-overlapping scenario's windows byte-identical to the pre-change hourly ones", () => {
    // KI-37's fix was verified against exactly these windows, so the stagger
    // rework must be a no-op for every scenario but `overlappingDay`. The
    // expectation restates the *pre-change* formula literally — `Math.min(9 + i,
    // 22)` over an activity's index within its day, one-hour windows — rather
    // than re-deriving it from the new code, so this is a real differential and
    // not a tautology.
    const pad = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
    let compared = 0;
    for (const scenario of otherScenarioNames) {
      const state = stateFromCommands(scenario, randomUUID());
      for (const day of state.days) {
        day.activityIds.forEach((id, i) => {
          const startHour = Math.min(9 + i, 22);
          expect(state.activities[id]!.timeWindow, `${scenario} day activity ${i}`).toEqual({
            start: pad(startHour),
            end: pad(startHour + 1),
          });
          compared += 1;
        });
      }
    }
    // Deterministic census of the current scenario table (emptyTrip 0,
    // threeDayTrip 6, overBudgetTrip 4, unscheduledHeavy 2, mappedTrip 5,
    // ungeocodedTrip 2), not a guessed floor: the loop above has no skipping
    // precondition, so an exact count is available and catches a generator that
    // silently stops producing cases.
    expect(compared).toBe(19);
  });
});

// The projection twin of the two suites above (KI-40). Same engine, same
// property, different door in: `scenarios` builds a `TripDetail` directly
// rather than replaying commands, so nothing but this file checks that the two
// halves of the package agree about which fixtures clash.
//
// Before KI-40 they did not. `activityFactory` gave EVERY activity the
// identical literal 09:00-11:00 window, and identical windows do satisfy
// `windowsOverlap`, so hydrating `threeDayTrip` — the ORDINARY case — and
// running the real engine reported three degenerate time-overlap conflicts,
// `overBudgetTrip` two and `ungeocodedTrip` one. `overlappingDay` was
// therefore not distinguished from its siblings at all. It is now the only
// scenario that clashes.
function buildScenario(name: ScenarioName): TripDetail {
  return name === "mappedTrip" ? scenarios.mappedTrip(5) : scenarios[name]();
}

describe("the projection side clashes only where it says it does", () => {
  it.each(otherScenarioNames)("scenarios.%s hydrates to no time-overlap conflict", (name) => {
    expect(timeOverlaps(detectConflicts(hydrate(buildScenario(name))))).toEqual([]);
  });

  it("scenarios.overlappingDay does overlap once put through the real engine", () => {
    const trip = scenarios.overlappingDay();
    const overlaps = timeOverlaps(detectConflicts(hydrate(trip)));
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]!.subjects).toEqual([...trip.days[0]!.activityIds].sort());
  });

  it("overlaps partially rather than identically, exactly as its command twin does", () => {
    // The two twins state the same pair of windows in two places —
    // `scenarios.ts` cannot import `commands.ts` (that would be a cycle), so
    // this asserts they agree instead of sharing a constant. If either side is
    // edited alone, this goes red.
    const trip = scenarios.overlappingDay();
    const projection = trip.days[0]!.activityIds.map((id) => trip.activities[id]!.timeWindow);
    const state = stateFromCommands("overlappingDay", randomUUID());
    const command = state.days[0]!.activityIds.map((id) => state.activities[id]!.timeWindow);

    expect(projection).toEqual([
      { start: "09:00", end: "10:00" },
      { start: "09:30", end: "10:30" },
    ]);
    expect(projection).toEqual(command);
    expect(projection[0]).not.toEqual(projection[1]);
  });

  it("stays overlap-free at the widest activity count the package builds", () => {
    // contract.test.ts builds 12 activities on one day; the hourly ladder has
    // 23 distinct slots, so this is well inside it. A regression to a shared
    // (or a clamped) window shows up here first, and on every day at once.
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 3, activitiesPerDay: 12, unscheduledCount: 6 } });
    const windows = trip.days.flatMap((d) => d.activityIds.map((id) => trip.activities[id]!.timeWindow));
    expect(windows).toHaveLength(36);
    expect(timeOverlaps(detectConflicts(hydrate(trip)))).toEqual([]);
  });

  it("still carries no conflicts of its own, because the factory never runs the engine", () => {
    // Unchanged by KI-40 and deliberately so: `tripDetailFactory` hardcodes
    // `conflicts: []` (trip.ts) and never calls the conflict engine, so
    // `scenarios.overlappingDay().conflicts` is empty however the windows read.
    // Whether the factory should populate `conflicts` is a design question
    // about what the factory is for; it is recorded here, not decided.
    expect(scenarios.overlappingDay().conflicts).toEqual([]);
  });
});
