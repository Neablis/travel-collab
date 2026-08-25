// Drift guard: loads the REAL design handoff export (not a fixture copy) and
// asserts the importer still turns it into commands that validate against
// the current @tc/contracts TripCommand schema. If a contract changes
// underneath this importer — a renamed field, a tightened regex, a new
// required property — this test goes red, which is the whole point (the
// task that created this importer: nothing else in the repo reads this
// file, so nothing else would ever notice the drift).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TripCommand } from "@tc/contracts";
import { DROPPED_SEED_FIELDS, importJapanTripSeed, parseTripSeed } from "./japanTripImporter";

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
    const commands = importJapanTripSeed(seed, randomUUID());

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

    const commands = importJapanTripSeed(seed, randomUUID());

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

  it("assigns every scheduled stop to one of the 14 minted day ids, and mints every id fresh (not derived, no repeats)", () => {
    const seed = loadRealSeed();
    const commands = importJapanTripSeed(seed, randomUUID());
    const setDates = commands.find((c) => c.type === "SetTripDates");
    if (setDates?.type !== "SetTripDates") throw new Error("expected a SetTripDates command");
    const dayIds = new Set(setDates.newDayIds);
    expect(dayIds.size).toBe(setDates.newDayIds.length); // no repeated day id

    const activityIds = new Set<string>();
    for (const command of commands) {
      if (command.type === "AddActivity") {
        expect(activityIds.has(command.activityId)).toBe(false); // no repeated activity id
        activityIds.add(command.activityId);
        if (command.dayId !== undefined) expect(dayIds.has(command.dayId)).toBe(true);
      }
    }
  });

  it("does not generate the trip id — every command carries whatever tripId the caller supplied", () => {
    const seed = loadRealSeed();
    const suppliedTripId = randomUUID();
    const commands = importJapanTripSeed(seed, suppliedTripId);
    expect(commands.some((c) => c.type === "CreateTrip")).toBe(false);
    for (const command of commands) {
      expect(command.tripId).toBe(suppliedTripId);
    }
  });

  // witness: the dropped-field list is the report's honesty check — if it's
  // ever quietly trimmed to "look" more complete, this catches the size
  // dropping below what auditing the real export actually found.
  it("documents at least as many dropped fields as the real export's shape requires", () => {
    expect(DROPPED_SEED_FIELDS.length).toBeGreaterThanOrEqual(25);
  });

  // witness: a real run of scripts/geocode-japan-seed.mts (2026-08-25)
  // resolved 54/72 stops (75%) against a live LocationIQ lookup — 18 stayed
  // coordinate-less: 9 transit stops whose day is labeled with the
  // destination city but whose stop is physically in the departure city (the
  // seed gives no per-stop city, only a per-day one — see stopToAddActivity's
  // comment), and 9 where LocationIQ itself returned zero results for the
  // exact "place, area, city, Japan" query (confirmed non-transient by a
  // manual re-query, not a rate limit — see /tmp/geocode-seed-report.md).
  // 50 is a floor a few below that measured 54, not the measured value
  // itself, so a future re-run's minor vendor-data drift doesn't flap this;
  // it still catches the overlay silently regressing toward empty (KI-15:
  // MapLens's 0-of-72 starting point this whole task exists to fix).
  it("attaches lat/lng to a substantial majority of the 72 stops via the committed geocode overlay", () => {
    const seed = loadRealSeed();
    const commands = importJapanTripSeed(seed, randomUUID());
    const withCoords = commands.filter(
      (c) => c.type === "AddActivity" && c.location?.lat !== undefined && c.location?.lng !== undefined,
    );
    expect(withCoords.length).toBeGreaterThanOrEqual(50);
  });
});
