import { describe, expect, it } from "vitest";
import type {
  ForecastDay, TripDetail, TripGlobals, TripWeather, TripWeatherPoint, TypicalMonth, UserPreferences,
} from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import type { WeatherPayload } from "../../weatherPayload";
import { weatherModeOf } from "./weather";

// "Weather" (M14 link 11, ADR-052). The mode table is decision 3's, one test
// per row, with a fixed `today` — the resolver never reads a clock.

const forecastDay = (over: Partial<ForecastDay> = {}): ForecastDay => ({
  source: "met-norway",
  asOf: "2026-11-10T09:10:00Z",
  highC: 17.6,
  lowC: 8.2,
  precipitationMm: 2.14,
  symbol: "lightrain_day",
  hours: [
    { at: "2026-11-10T11:00:00Z", tempC: 12.4, precipitationMm: 0.2, symbol: "cloudy" },
    { at: "2026-11-10T12:00:00Z", tempC: 14.9, precipitationMm: 0, symbol: "cloudy" },
    { at: "2026-11-10T18:00:00Z", tempC: 9.6, precipitationMm: 1.1, symbol: "rain" },
  ],
  ...over,
});

const typicalMonth = (over: Partial<TypicalMonth> = {}): TypicalMonth => ({
  source: "nasa-power",
  month: 11,
  highC: 13.2,
  lowC: 4.4,
  precipitationMmPerDay: 3.46,
  period: { fromYear: 2001, throughYear: 2020 },
  ...over,
});

const point = (date: string, over: Partial<TripWeatherPoint> = {}): TripWeatherPoint => ({
  date,
  city: "Kyoto",
  forecast: forecastDay(),
  typical: typicalMonth(),
  ...over,
});

function setup(dates: (string | null)[], points: TripWeatherPoint[]) {
  const built = tripDetailFactory.build({}, { transient: { dayCount: dates.length, activitiesPerDay: 1 } });
  const trip: TripDetail = { ...built, days: built.days.map((day, i) => ({ ...day, date: dates[i]! })) };
  const globals: TripGlobals = {
    days: dates.map((date, index) => ({
      index, date, cities: ["Kyoto"], activityCount: 1, costSubtotal: 0,
      place: { lat: 35.01, lng: 135.77, city: "Kyoto" }, timeZone: "Asia/Tokyo",
    })),
    cities: [], tags: [], homeTimeZone: null,
  };
  const weather: TripWeather = { points };
  return { trip, globals, weather };
}

function ctxOf(
  { trip, globals, weather }: ReturnType<typeof setup>,
  today: string | null,
  slot: "ready" | "pending" | "failed" = "ready",
  user: UserPreferences | null = null,
): WidgetContext {
  return {
    trip, page: { tripId: trip.tripId }, user, globals, today,
    external: { weather: slot === "ready" ? { state: "ready", value: weather } : { state: slot } },
  };
}

function payloadOf(ctx: WidgetContext, params: Record<string, unknown> = {}): WeatherPayload {
  const outcome = renderMacro(ctx, "day.weather", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "weather") {
    throw new Error(`expected a weather block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("weatherModeOf — ADR-052 decision 3's table", () => {
  const today = "2026-11-10";

  it("a day inside the forecast is `forecast`", () => {
    expect(weatherModeOf(point("2026-11-13"), today)).toBe("forecast");
  });

  it("the day itself is `today`", () => {
    expect(weatherModeOf(point(today), today)).toBe("today");
  });

  it("a day past the forecast's last full day is `typical`", () => {
    expect(weatherModeOf(point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } }), today)).toBe("typical");
  });

  it("a day already gone is `past` — typical, and labelled as not what it was", () => {
    // Even with a forecast in hand: a forecast for yesterday is not what it was either.
    expect(weatherModeOf(point("2026-11-09"), today)).toBe("past");
  });

  it("a forecast that failed inside the horizon falls back to typical, labelled", () => {
    expect(weatherModeOf(point("2026-11-12", { forecast: { unavailable: "source" } }), today)).toBe("no-forecast");
    expect(weatherModeOf(point(today, { forecast: { unavailable: "source" } }), today)).toBe("no-forecast");
  });

  it("with neither source, the row is unavailable", () => {
    const neither = { forecast: { unavailable: "source" as const }, typical: { unavailable: "source" as const } };
    expect(weatherModeOf(point("2026-11-12", neither), today)).toBe("unavailable");
    expect(weatherModeOf(point("2026-11-09", neither), today)).toBe("unavailable");
  });
});

describe("day.weather", () => {
  const dates = ["2026-11-09", "2026-11-10", "2026-11-13", "2026-11-30"];
  const trip = () =>
    setup(dates, [
      point("2026-11-09"),
      point("2026-11-10"),
      point("2026-11-13", { forecast: forecastDay({ asOf: "2026-11-10T06:00:00Z" }) }),
      point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } }),
    ]);

  it("names every row's mode in words", () => {
    const payload = payloadOf(ctxOf(trip(), "2026-11-10"));
    expect(payload.rows.map((row) => [row.label, row.modeText])).toEqual([
      ["Day 1", "Past day · Nov avg"],
      ["Day 2", "Today"],
      ["Day 3", "Forecast"],
      ["Day 4", "November average"],
    ]);
  });

  it("prints the values each mode has, rounded, as data", () => {
    const [past, today, forecast] = payloadOf(ctxOf(trip(), "2026-11-10")).rows;
    expect(forecast).toMatchObject({ high: "18°", low: "8°", rain: "2.1 mm", sky: "Light rain", now: null });
    // Today: now, and the rest of the day from the hours still to come.
    expect(today).toMatchObject({ now: "12°", high: "15°", low: "10°", rain: "1.3 mm" });
    // Typical: an amount per day, never a chance of rain (ADR-052 review point 5).
    expect(past).toMatchObject({ high: "13°", low: "4°", rain: "3.5 mm a day", sky: null, now: null });
  });

  it("carries the oldest forecast as-of shown, the averaging period, and both credits", () => {
    const payload = payloadOf(ctxOf(trip(), "2026-11-10"));
    expect(payload.forecastAsOf).toBe("2026-11-10T06:00:00Z");
    expect(payload.typicalPeriod).toBe("2001–2020");
    expect(payload.credits.map((c) => [c.label, c.text])).toEqual([
      ["Forecast", "Norwegian Meteorological Institute, CC BY 4.0"],
      ["Monthly averages", "NASA POWER"],
    ]);
    expect(payload.credits[0]!.href).toBe("https://api.met.no/doc/License");
  });

  it("credits only the sources whose data is on the block", () => {
    const only = setup(["2026-11-30"], [point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } })]);
    const payload = payloadOf(ctxOf(only, "2026-11-10"));
    expect(payload.credits.map((c) => c.source)).toEqual(["nasa-power"]);
    expect(payload.forecastAsOf).toBeNull();
  });

  it("is `unavailable(pending)` while the reader's date is unknown — the mode cannot be chosen yet", () => {
    expect(renderMacro(ctxOf(trip(), null), "day.weather", {})).toEqual({ status: "unavailable", reason: "pending" });
  });

  it("is `unavailable` while the slot is pending, and `source` when the request failed", () => {
    expect(renderMacro(ctxOf(trip(), "2026-11-10", "pending"), "day.weather", {})).toEqual({ status: "unavailable", reason: "pending" });
    expect(renderMacro(ctxOf(trip(), "2026-11-10", "failed"), "day.weather", {})).toEqual({ status: "unavailable", reason: "source" });
  });

  it("is `unavailable(source)` when no row has anything to show — the world did not answer", () => {
    const down = { forecast: { unavailable: "source" as const }, typical: { unavailable: "source" as const } };
    const t = setup(["2026-11-10", "2026-11-12"], [point("2026-11-10", down), point("2026-11-12", down)]);
    expect(renderMacro(ctxOf(t, "2026-11-10"), "day.weather", {})).toEqual({ status: "unavailable", reason: "source" });
  });

  it("keeps a row that has nothing, when another row does", () => {
    const t = setup(
      ["2026-11-10", "2026-11-12"],
      [point("2026-11-10"), point("2026-11-12", { forecast: { unavailable: "source" }, typical: { unavailable: "source" } })],
    );
    expect(payloadOf(ctxOf(t, "2026-11-10")).rows.map((r) => r.modeText)).toEqual(["Today", "Weather unavailable"]);
  });

  it("is `empty` with the fix when a day has no place — trip data, not the source", () => {
    const t = setup(["2026-11-10"], []);
    expect(renderMacro(ctxOf(t, "2026-11-10"), "day.weather", {})).toEqual({ status: "empty", because: "no place on this day" });
  });

  it("asks for dates when no selected day has one", () => {
    const t = setup([null], [point("2026-11-10")]);
    expect(renderMacro(ctxOf(t, "2026-11-10"), "day.weather", {})).toEqual({
      status: "empty", because: "set the trip's dates to see this",
    });
  });

  it("narrows to a day like every day primitive", () => {
    const payload = payloadOf(ctxOf(trip(), "2026-11-10"), { day: { kind: "index", index: 2 } });
    expect(payload.rows.map((r) => r.label)).toEqual(["Day 3"]);
  });

  // Mitchell, on the #221 preview: *"Make sure we are respecting the account
  // settings for fahrenheit vs celsius, or metric vs imperial."* The account
  // has one unit setting, `distanceUnit`, and the weather reads it: miles is
  // °F and inches, km is °C and mm (ADR-052's 2026-09-24 amendment).
  describe("units, from the account's distance unit", () => {
    const miles: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "mi", timeFormat: "12h" };
    const km: UserPreferences = { ...miles, distanceUnit: "km" };

    it("prints °F and inches for an account in miles, whole degrees and two places", () => {
      const [past, today, forecast] = payloadOf(ctxOf(trip(), "2026-11-10", "ready", miles)).rows;
      // 17.6 °C = 63.7 °F, 8.2 °C = 46.8 °F, 2.14 mm = 0.084 in.
      expect(forecast).toMatchObject({ high: "64°", low: "47°", rain: "0.08 in" });
      expect(today).toMatchObject({ now: "54°", high: "59°", low: "49°", rain: "0.05 in" });
      expect(past).toMatchObject({ high: "56°", low: "40°", rain: "0.14 in a day" });
    });

    it("prints °C and mm for an account in km, and when the account's preferences did not load", () => {
      const metric = { high: "18°", low: "8°", rain: "2.1 mm" };
      expect(payloadOf(ctxOf(trip(), "2026-11-10", "ready", km)).rows[2]).toMatchObject(metric);
      expect(payloadOf(ctxOf(trip(), "2026-11-10", "ready", null)).rows[2]).toMatchObject(metric);
    });

    it("says a trace of rain in inches rather than rounding it to none", () => {
      const t = setup(
        ["2026-11-12", "2026-11-13"],
        [
          point("2026-11-12", { forecast: forecastDay({ precipitationMm: 0.1 }) }),
          point("2026-11-13", { forecast: forecastDay({ precipitationMm: 0 }) }),
        ],
      );
      expect(payloadOf(ctxOf(t, "2026-11-10", "ready", miles)).rows.map((r) => r.rain)).toEqual(["<0.01 in", "0.00 in"]);
    });

    it("never prints -0°, in either unit", () => {
      // -17.9 °C is -0.2 °F; -0.4 °C is itself a rounded -0.
      const t = setup(
        ["2026-11-12"],
        [point("2026-11-12", { forecast: forecastDay({ highC: -0.4, lowC: -17.9 }) })],
      );
      expect(payloadOf(ctxOf(t, "2026-11-10", "ready", miles)).rows[0]).toMatchObject({ high: "31°", low: "0°" });
      expect(payloadOf(ctxOf(t, "2026-11-10", "ready", km)).rows[0]).toMatchObject({ high: "0°", low: "-18°" });
    });
  });

  // *"I have no idea what the columns are without a column header. But might
  // be good to make that a toggle."* Shown unless the author turns it off.
  it("carries column headings by default, and not when the author turned them off", () => {
    expect(payloadOf(ctxOf(trip(), "2026-11-10")).headings).toBe(true);
    expect(payloadOf(ctxOf(trip(), "2026-11-10"), { headings: false }).headings).toBe(false);
  });

  it("gives a travel day one row per city", () => {
    const t = setup(["2026-11-13"], [point("2026-11-13", { city: "Kyoto" }), point("2026-11-13", { city: "Osaka" })]);
    expect(payloadOf(ctxOf(t, "2026-11-10")).rows.map((r) => r.city)).toEqual(["Kyoto", "Osaka"]);
  });
});
