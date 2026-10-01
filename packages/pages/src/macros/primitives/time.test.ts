import { describe, expect, it } from "vitest";
import type { TripDetail, TripGlobals, UserPreferences } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import type { SunPayload } from "../../sunPayload";
import { readerOn } from "../../test-support/reader";

// "Sunrise and sunset" and "Time difference from home" (M14 link 11). Both
// read the day's place and zone off the globals projection — the server put
// them there (`TripGlobals`) — and do the arithmetic with `Intl`.

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const REYKJAVIK = { lat: 64.1466, lng: -21.9426 };
const LONGYEARBYEN = { lat: 78.22, lng: 15.65 };

type DaySpec = {
  date: string | null; city?: string; cities?: string[]; place?: { lat: number; lng: number }; placeCity?: string; zone?: string;
};

// The trip comes from the factory; only its dates are set here, and the
// globals are a literal the way `test-support/selectionTrip.ts` writes them:
// `buildTripGlobals` lives in `apps/web/src/server`, which this package may
// not import, so a hand-written projection is data to read against the trip.
function setup(days: DaySpec[], homeTimeZone: string | null = "America/Los_Angeles") {
  const built = tripDetailFactory.build({}, { transient: { dayCount: days.length, activitiesPerDay: 1 } });
  const trip: TripDetail = { ...built, days: built.days.map((day, i) => ({ ...day, date: days[i]!.date })) };
  const globals: TripGlobals = {
    days: days.map((spec, index) => ({
      index, date: spec.date, cities: spec.cities ?? (spec.city ? [spec.city] : []), activityCount: 1, costSubtotal: 0,
      place: spec.place ? { ...spec.place, city: spec.placeCity ?? spec.city ?? null } : null, timeZone: spec.zone ?? null,
    })),
    cities: [], tags: [], homeTimeZone,
  };
  return { trip, globals };
}

const contextOf = (
  { trip, globals }: { trip: TripDetail; globals: TripGlobals | null },
  user: UserPreferences | null = null,
): WidgetContext => ({ trip, page: { tripId: trip.tripId }, user, globals, today: null });

const sun = (ctx: WidgetContext, params: Record<string, unknown> = {}): SunPayload => {
  const outcome = renderMacro(ctx, "day.sun", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "sun") {
    throw new Error(`expected a sun block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
};
const sentence = (ctx: WidgetContext, params: Record<string, unknown> = {}) => {
  const outcome = renderMacro(ctx, "day.fromHome", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") throw new Error(`expected inline, got ${JSON.stringify(outcome)}`);
  return outcome.rendered.segs;
};

describe("day.sun", () => {
  const trip = () =>
    setup([
      { date: "2026-06-21", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" },
      { date: "2026-06-21", city: "Reykjavik", place: REYKJAVIK, zone: "Atlantic/Reykjavik" },
      { date: "2026-06-23", city: "Kyoto" },
    ]);
  const equinox = () => setup([{ date: "2026-03-20", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }]);

  // Also the stored-document guarantee: a `day.sun` node saved when the widget
  // was a repeat carries `params: {}`, and the shape is the registry's, not the
  // document's — so it reads as the graphic block with no migration.
  it("is a block, the graphic unless the table is asked for", () => {
    expect(sun(contextOf(trip()))).toMatchObject({ kind: "sun", view: "graphic", summary: "Sunrise and sunset for 2 days." });
    expect(sun(contextOf(trip()), { view: "table" }).view).toBe("table");
    expect(sun(contextOf(equinox())).summary).toBe("Sunrise and sunset for 1 day.");
  });

  it("gives each located day its sunrise, sunset and daylight in that day's local time", () => {
    const [tokyo] = sun(contextOf(trip())).rows;
    expect(tokyo).toMatchObject({ key: "0", label: "Day 1", city: "Tokyo", state: "normal" });
    expect(tokyo!.sunrise).toMatch(/^4:2[4-7] am$/);
    expect(tokyo!.sunriseMinute).toBeGreaterThanOrEqual(264);
    expect(tokyo!.sunriseMinute).toBeLessThanOrEqual(267);
    expect(tokyo!.sunset).toMatch(/^(6:5[89] pm|7 pm|7:0[12] pm)$/);
    expect(tokyo!.daylight).toMatch(/^14h \d+m$/);
  });

  // The golden hour is drawn, not written: the payload says where it ends and
  // starts, inside the day's light.
  it("places the golden hours inside the daylight", () => {
    const [tokyo] = sun(contextOf(trip())).rows;
    expect(tokyo!.goldenMorningEndMinute).toBeGreaterThan(tokyo!.sunriseMinute!);
    expect(tokyo!.goldenEveningStartMinute).toBeLessThan(tokyo!.sunsetMinute!);
    expect(tokyo!.goldenMorningEndMinute).toBeLessThan(tokyo!.goldenEveningStartMinute!);
  });

  // CodeRabbit on #223: an earlier stop with a city and no coordinates put its
  // name on the day, over another city's sunrise.
  it("names the sunrise by the stop that located the day, not the day's first city", () => {
    const [row] = sun(contextOf(setup([
      { date: "2026-06-21", cities: ["Kyoto", "Tokyo"], place: TOKYO, placeCity: "Tokyo", zone: "Asia/Tokyo" },
    ]))).rows;
    expect(row!.city).toBe("Tokyo");
  });

  // Reykjavik's June sunset is past midnight. It keeps its marker and its true
  // minute, and the axis stops at the day's end: the ribbon clamps, the label
  // does not.
  it("says so when a sunset falls after midnight, and ends the axis at midnight", () => {
    const payload = sun(contextOf(trip()));
    const reykjavik = payload.rows[1]!;
    expect(reykjavik.sunset).toMatch(/^12(:0\d)? am \(next day\)$/);
    expect(reykjavik.sunsetMinute).toBeGreaterThan(1440);
    expect(payload.axis.endMinute).toBe(1440);
    expect(payload.axis.startMinute).toBeLessThan(300);
  });

  // 3 am to midnight is eight three-hour ticks, and eight labels collide over
  // a ribbon. A widened axis is ticked every six hours instead.
  it("ticks a widened axis every six hours, never more than five labels", () => {
    const { axis } = sun(contextOf(trip()));
    expect(axis.ticks).toEqual([
      { minute: 360, label: "6a" }, { minute: 720, label: "noon" },
      { minute: 1080, label: "6p" }, { minute: 1440, label: "midnight" },
    ]);
  });

  it("keeps the base axis, 5 am to 6 pm, for a day that fits inside it", () => {
    const { axis } = sun(contextOf(equinox()));
    expect(axis).toMatchObject({ startMinute: 300, endMinute: 1080 });
    expect(axis.ticks).toEqual([
      { minute: 360, label: "6a" }, { minute: 540, label: "9a" }, { minute: 720, label: "noon" },
      { minute: 900, label: "3p" }, { minute: 1080, label: "6p" },
    ]);
  });

  // The reader's clock, not the design's: a 24-hour reader gets "04:25", and
  // Reykjavik's after-midnight sunset keeps its marker in either format.
  it("prints the sun's times and the axis on the reader's 24-hour clock when that is their setting", () => {
    const payload = sun(contextOf(trip(), readerOn("24h")));
    const [tokyo, reykjavik] = payload.rows;
    expect(tokyo!.sunrise).toMatch(/^04:2[4-7]$/);
    expect(tokyo!.sunset).toMatch(/^(18:5[89]|19:0[0-2])$/);
    expect(reykjavik!.sunset).toMatch(/^00:0\d \(next day\)$/);
    // The axis says the hour alone: "06:00" five times over does not fit a phone's ribbon.
    expect(payload.axis.ticks.map((tick) => tick.label)).toEqual(["06", "12", "18", "00"]);
  });

  // West of 180° on UTC+13: the day's own sun, never the next day's marked
  // "(next day)" (#223 review). SunCalc: 06:11 / 19:02.
  it("gives Apia that day's sunrise, not the next morning's", () => {
    const apia = setup([{ date: "2027-01-15", city: "Apia", place: { lat: -13.8333, lng: -171.7667 }, zone: "Pacific/Apia" }]);
    const [row] = sun(contextOf(apia)).rows;
    expect(row!.sunrise).toMatch(/^6:(09|1[0-3]) am$/);
    expect(row!.sunset).toMatch(/^(7 pm|7:0[1-4] pm)$/);
  });

  it("leaves out a day with no located stop, and is empty when that is every day", () => {
    expect(sun(contextOf(trip())).rows.map((row) => row.label)).toEqual(["Day 1", "Day 2"]);
    const outcome = renderMacro(contextOf(trip()), "day.sun", { day: { kind: "index", index: 2 } });
    expect(outcome).toMatchObject({ status: "empty" });
    expect(outcome).not.toHaveProperty("because");
  });

  it("says the sun does not set under the midnight sun, and does not rise in the polar night", () => {
    const polar = setup([
      { date: "2026-06-21", city: "Longyearbyen", place: LONGYEARBYEN, zone: "Arctic/Longyearbyen" },
      { date: "2026-12-21", city: "Longyearbyen", place: LONGYEARBYEN, zone: "Arctic/Longyearbyen" },
    ]);
    const NO_TIMES = { sunriseMinute: null, sunsetMinute: null, sunrise: null, sunset: null };
    const payload = sun(contextOf(polar));
    expect(payload.rows).toMatchObject([
      { state: "up-all-day", words: "sun up all day", daylight: "24h", ...NO_TIMES },
      {
        state: "down-all-day", words: "sun down all day", daylight: "0h", ...NO_TIMES,
        goldenMorningEndMinute: null, goldenEveningStartMinute: null,
      },
    ]);
    // The words are a polar day's alone: a day with two times prints those.
    expect(sun(contextOf(equinox())).rows.map((row) => row.words)).toEqual([null]);
    // A sun that is up all day needs the whole day to be drawn across.
    expect(payload.axis).toMatchObject({ startMinute: 0, endMinute: 1440 });
    expect(payload.axis.ticks.map((tick) => tick.label)).toEqual(["midnight", "6a", "noon", "6p", "midnight"]);
  });

  it("asks for dates when the located days have none", () => {
    const undated = setup([{ date: null, city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }]);
    expect(renderMacro(contextOf(undated), "day.sun", {})).toMatchObject({ status: "empty", because: "set the trip's dates to see this" });
  });

  it("has nothing to show before the globals arrive, rather than guessing a place", () => {
    expect(renderMacro(contextOf({ ...trip(), globals: null }), "day.sun", {}).status).toBe("empty");
  });
});

describe("day.fromHome", () => {
  it("reads the difference on the day, daylight saving included", () => {
    const summer = setup([{ date: "2026-06-21", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }]);
    expect(sentence(contextOf(summer))).toEqual([
      { kind: "chip", name: "city", text: "Tokyo" },
      { kind: "text", text: " is " },
      { kind: "chip", name: "value", text: "16h" },
      { kind: "text", text: " ahead of home" },
    ]);
    // Los Angeles is on standard time in January, so Tokyo is an hour further.
    const winter = setup([{ date: "2026-01-15", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }]);
    expect(sentence(contextOf(winter))[2]!.text).toBe("17h");
  });

  it("handles a half-hour home, and a place behind home", () => {
    const tokyo = setup([{ date: "2026-06-21", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }], "Asia/Kolkata");
    expect(sentence(contextOf(tokyo)).map((s) => s.text).join("")).toBe("Tokyo is 3h 30m ahead of home");
    const reykjavik = setup([{ date: "2026-06-21", city: "Reykjavik", place: REYKJAVIK, zone: "Atlantic/Reykjavik" }], "Asia/Tokyo");
    expect(sentence(contextOf(reykjavik)).map((s) => s.text).join("")).toBe("Reykjavik is 9h behind home");
  });

  it("says a place on home time is on home time, not zero hours ahead", () => {
    const same = setup([{ date: "2026-06-21", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }], "Asia/Tokyo");
    expect(sentence(contextOf(same)).map((s) => s.text).join("")).toBe("Tokyo keeps home time");
  });

  it("says each place once, in trip order, when the days cover several", () => {
    const trip = setup([
      { date: "2026-06-20", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" },
      { date: "2026-06-21", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" },
      { date: "2026-06-22", city: "Reykjavik", place: REYKJAVIK, zone: "Atlantic/Reykjavik" },
    ]);
    expect(sentence(contextOf(trip)).map((s) => s.text).join("")).toBe(
      "Tokyo is 16h ahead of home; Reykjavik is 7h ahead of home",
    );
  });

  it("names each place by the stop that located it", () => {
    const trip = setup([
      { date: "2026-06-21", cities: ["Kyoto", "Tokyo"], place: TOKYO, placeCity: "Tokyo", zone: "Asia/Tokyo" },
    ]);
    expect(sentence(contextOf(trip)).map((s) => s.text).join("")).toBe("Tokyo is 16h ahead of home");
  });

  it("reads a day with no date on today, when the page knows today", () => {
    const undated = setup([{ date: null, city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }]);
    expect(renderMacro(contextOf(undated), "day.fromHome", {}).status).toBe("empty");
    const outcome = renderMacro({ ...contextOf(undated), today: "2026-01-15" }, "day.fromHome", {});
    expect(outcome.status === "ok" && outcome.rendered.kind === "inline" && outcome.rendered.segs[2]!.text).toBe("17h");
  });

  it("asks for a home airport when the account has none, in words a reader can act on", () => {
    const trip = setup([{ date: "2026-06-21", city: "Tokyo", place: TOKYO, zone: "Asia/Tokyo" }], null);
    expect(renderMacro(contextOf(trip), "day.fromHome", {})).toMatchObject({
      status: "empty",
      because: "set a home airport in Account to see this",
    });
    const user = { displayName: null, homeAirport: "QQQ", distanceUnit: "km", timeFormat: "12h" } as unknown as UserPreferences;
    expect(renderMacro(contextOf(trip, user), "day.fromHome", {})).toMatchObject({
      status: "empty",
      because: "no time zone known for QQQ",
    });
  });
});
