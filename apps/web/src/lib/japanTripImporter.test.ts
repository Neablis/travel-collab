// Drift guard: loads the REAL design handoff export (not a fixture copy) and
// asserts the importer still turns it into commands that validate against
// the current @tc/contracts TripCommand schema. If a contract changes
// underneath this importer — a renamed field, a tightened regex, a new
// required property — this test goes red, which is the whole point (the
// task that created this importer: nothing else in the repo reads this
// file, so nothing else would ever notice the drift).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TripCommand } from "@tc/contracts";
import { DROPPED_SEED_FIELDS, importJapanTripSeed, parseTripSeed } from "../../scripts/japanTripImporter";

const SEED_PATH = resolve(import.meta.dirname, "../../../../.design-sync/handoff/data/japan-trip-seed.json");

function loadRealSeed() {
  const raw = readFileSync(SEED_PATH, "utf-8");
  return parseTripSeed(JSON.parse(raw));
}

describe("japanTripImporter", () => {
  it("validates the real handoff export against trip-seed/v1", () => {
    expect(() => loadRealSeed()).not.toThrow();
  });

  it("produces only commands that validate against the current TripCommand contract", () => {
    const seed = loadRealSeed();
    const commands = importJapanTripSeed(seed);

    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      const result = TripCommand.safeParse(command);
      if (!result.success) {
        throw new Error(`command failed TripCommand validation: ${JSON.stringify(command)}\n${result.error.message}`);
      }
    }
  });

  it("places all 14 days, all 68 stops, and all 4 unscheduled items", () => {
    const seed = loadRealSeed();
    expect(seed.days).toHaveLength(14);
    expect(seed.trip.stopCount).toBe(68);
    expect(seed.unscheduled).toHaveLength(4);

    const commands = importJapanTripSeed(seed);

    const setDates = commands.find((c) => c.type === "SetTripDates");
    expect(setDates?.type).toBe("SetTripDates");
    if (setDates?.type === "SetTripDates") expect(setDates.newDayIds).toHaveLength(14);

    const addActivities = commands.filter((c) => c.type === "AddActivity");
    expect(addActivities).toHaveLength(68 + 4);

    const onADay = addActivities.filter((c) => c.type === "AddActivity" && c.dayId !== undefined);
    const backlog = addActivities.filter((c) => c.type === "AddActivity" && c.dayId === undefined);
    expect(onADay).toHaveLength(68);
    expect(backlog).toHaveLength(4);
  });

  it("assigns every scheduled stop to one of the 14 minted day ids", () => {
    const seed = loadRealSeed();
    const commands = importJapanTripSeed(seed);
    const setDates = commands.find((c) => c.type === "SetTripDates");
    if (setDates?.type !== "SetTripDates") throw new Error("expected a SetTripDates command");
    const dayIds = new Set(setDates.newDayIds);

    for (const command of commands) {
      if (command.type === "AddActivity" && command.dayId !== undefined) {
        expect(dayIds.has(command.dayId)).toBe(true);
      }
    }
  });

  it("re-running the importer on the same seed produces identical ids (deterministic, not crypto.randomUUID)", () => {
    const seed = loadRealSeed();
    const first = importJapanTripSeed(seed);
    const second = importJapanTripSeed(seed);
    expect(second).toEqual(first);
  });

  it("keeps every command's tripId consistent with CreateTrip's", () => {
    const seed = loadRealSeed();
    const commands = importJapanTripSeed(seed);
    const created = commands.find((c) => c.type === "CreateTrip");
    if (created?.type !== "CreateTrip") throw new Error("expected a CreateTrip command");
    for (const command of commands) {
      expect("tripId" in command ? command.tripId : undefined).toBe(created.tripId);
    }
  });

  // witness: the dropped-field list is the report's honesty check — if it's
  // ever quietly trimmed to "look" more complete, this catches the size
  // dropping below what auditing the real export actually found.
  it("documents at least as many dropped fields as the real export's shape requires", () => {
    expect(DROPPED_SEED_FIELDS.length).toBeGreaterThanOrEqual(25);
  });
});
