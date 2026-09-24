import { describe, expect, it } from "vitest";
import type { TripDetail, TripGlobals, UserPreferences } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { Rendered, WidgetContext } from "../../registry-types";

// "Sunrise and sunset" and "Time difference from home" (M14 link 11). Both
// read the day's place and zone off the globals projection — the server put
// them there (`TripGlobals`) — and do the arithmetic with `Intl`.

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const REYKJAVIK = { lat: 64.1466, lng: -21.9426 };
const TROMSO = { lat: 69.6492, lng: 18.9553 };

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
    cities: [], tags: [], bookedCount: 0, homeTimeZone,
  };
  return { trip, globals };
}

const contextOf = (
  { trip, globals }: { trip: TripDetail; globals: TripGlobals | null },
  user: UserPreferences | null = null,
): WidgetContext => ({ trip, page: { tripId: trip.tripId }, user, globals, today: null });

const rowsOf = (rendered: Rendered) => {
  if (rendered.kind !== "rows") throw new Error(`expected rows, got ${rendered.kind}`);
  return rendered.rows.map((row) => [row.lead, ...row.cells].map((cell) => cell.map((seg) => seg.text).join(" ")));
};
const sun = (ctx: WidgetContext, params: Record<string, unknown> = {}) => {
  const outcome = renderMacro(ctx, "day.sun", params);
  if (outcome.status !== "ok") throw new Error(`expected ok, got ${JSON.stringify(outcome)}`);
  return rowsOf(outcome.rendered);
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

  it("gives each located day its sunrise, sunset and golden hour in that day's local time", () => {
    const [tokyo] = sun(contextOf(trip()));
    expect(tokyo![0]).toBe("Day 1");
    expect(tokyo![1]).toBe("Tokyo");
    expect(tokyo![2]).toMatch(/^sunrise 04:2[4-7]$/);
    expect(tokyo![3]).toMatch(/^sunset (18:5[89]|19:0[0-2])$/);
    expect(tokyo![4]).toMatch(/^golden hour 04:2\d–05:0\d and 18:2\d–(18:5\d|19:0\d)$/);
  });

  // CodeRabbit on #223: an earlier stop with a city and no coordinates put its
  // name on the day, over another city's sunrise.
  it("names the sunrise by the stop that located the day, not the day's first city", () => {
    const [row] = sun(contextOf(setup([
      { date: "2026-06-21", cities: ["Kyoto", "Tokyo"], place: TOKYO, placeCity: "Tokyo", zone: "Asia/Tokyo" },
    ])));
    expect(row![1]).toBe("Tokyo");
  });

  it("says so when a sunset falls after midnight, rather than printing it as the morning's", () => {
    const [, reykjavik] = sun(contextOf(trip()));
    expect(reykjavik![3]).toMatch(/^sunset 00:0\d \(next day\)$/);
  });

  // West of 180° on UTC+13: the day's own sun, never the next day's marked
  // "(next day)" (#223 review). SunCalc: 06:11 / 19:02.
  it("gives Apia that day's sunrise, not the next morning's", () => {
    const apia = setup([{ date: "2027-01-15", city: "Apia", place: { lat: -13.8333, lng: -171.7667 }, zone: "Pacific/Apia" }]);
    const [row] = sun(contextOf(apia));
    expect(row![2]).toMatch(/^sunrise 06:(09|1[0-3])$/);
    expect(row![3]).toMatch(/^sunset (19:0[0-4])$/);
  });

  it("leaves out a day with no located stop, and is empty when that is every day", () => {
    expect(sun(contextOf(trip())).map((row) => row[0])).toEqual(["Day 1", "Day 2"]);
    const outcome = renderMacro(contextOf(trip()), "day.sun", { day: { kind: "index", index: 2 } });
    expect(outcome.status).toBe("empty");
  });

  it("says the sun does not set under the midnight sun, and does not rise in the polar night", () => {
    const polar = setup([
      { date: "2026-06-21", city: "Tromsø", place: TROMSO, zone: "Europe/Oslo" },
      { date: "2026-12-21", city: "Tromsø", place: TROMSO, zone: "Europe/Oslo" },
    ]);
    const [june, december] = sun(contextOf(polar));
    expect(june!.slice(2, 4)).toEqual(["sun up all day", ""]);
    expect(december!.slice(2)).toEqual(["sun down all day", "", ""]);
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
    const user = { displayName: null, homeAirport: "QQQ", distanceUnit: "km" } as unknown as UserPreferences;
    expect(renderMacro(contextOf(trip, user), "day.fromHome", {})).toMatchObject({
      status: "empty",
      because: "no time zone known for QQQ",
    });
  });
});
