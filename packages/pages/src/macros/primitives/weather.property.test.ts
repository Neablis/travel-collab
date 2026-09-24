import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripWeatherPoint } from "@tc/contracts";
import { witness } from "../../test-support/witness";
import { weatherModeOf } from "./weather";

// ADR-052 decision 3's table, for EVERY pair of dates and every combination of
// what the two sources answered — the unit tests pin one example per row; this
// holds the rules that make the table a table:
//
// - the mode follows the calendar: `past` only before today, `today` only on
//   it, `forecast`/`typical` only after it;
// - a forecast is never shown for a day already gone, and always shown for
//   today-or-later when one is in hand;
// - every typical mode has normals behind it, and `unavailable` means neither
//   source has anything this row could show.

const DAY_MS = 86_400_000;
const dayOf = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY_MS).toISOString().slice(0, 10);
// The reader's date is mostly NEAR the trip day — within a fortnight either
// side, where the modes change — and sometimes anywhere, including across a
// year end. Two independent dates would land on "today" about once a run.
const datesArb = fc.integer({ min: 20, max: 800 }).chain((n) =>
  fc.tuple(
    fc.constant(dayOf(n)),
    fc.oneof(fc.integer({ min: -14, max: 14 }).map((d) => dayOf(n + d)), fc.integer({ min: 0, max: 820 }).map(dayOf)),
  ),
);

const forecastArb = fc.constantFrom<TripWeatherPoint["forecast"]>(
  { unavailable: "source" },
  { unavailable: "not-in-horizon" },
  { source: "met-norway", asOf: "2026-01-01T00:00:00Z", highC: 10, lowC: 2, precipitationMm: 0, symbol: null, hours: [] },
);
const typicalArb = fc.constantFrom<TripWeatherPoint["typical"]>(
  { unavailable: "source" },
  { source: "nasa-power", month: 1, highC: 5, lowC: -1, precipitationMmPerDay: 2, period: { fromYear: 2001, throughYear: 2020 } },
);

describe("weatherModeOf — for all dates", () => {
  it("follows the calendar and never shows what it does not have", () => {
    const w = witness("weather mode");
    const seen = new Set<string>();
    fc.assert(
      fc.property(datesArb, forecastArb, typicalArb, ([date, today], forecast, typical) => {
        const mode = weatherModeOf({ date, city: null, forecast, typical }, today);
        const hasForecast = !("unavailable" in forecast);
        const hasTypical = !("unavailable" in typical);
        w.tick();
        seen.add(mode);

        if (mode === "past") expect(date < today).toBe(true);
        if (mode === "today") expect(date).toBe(today);
        if (mode === "forecast" || mode === "typical") expect(date > today).toBe(true);
        if (mode === "today" || mode === "forecast") expect(hasForecast).toBe(true);
        if (mode === "typical" || mode === "past" || mode === "no-forecast") expect(hasTypical).toBe(true);
        // Beyond the horizon is plain typical; a failed forecast is labelled.
        if (mode === "typical") expect(forecast).toEqual({ unavailable: "not-in-horizon" });

        if (date < today) expect(["past", "unavailable"]).toContain(mode);
        if (date >= today && hasForecast) expect(mode).toBe(date === today ? "today" : "forecast");
        if (mode === "unavailable") expect(date >= today && hasForecast).toBe(false);
        if (mode === "unavailable") expect(hasTypical).toBe(false);
      }),
      { numRuns: 1000 },
    );
    // No guard clause: every case asserts, so the floor is `numRuns` exactly.
    w.atLeast(1000);
    // And the table is reached, not just allowed: every row of it turned up.
    expect([...seen].sort()).toEqual(["forecast", "no-forecast", "past", "today", "typical", "unavailable"]);
  });
});
