import { z } from "zod";
import type { FilterDimension, TimeFormat, TripGlobals } from "@tc/contracts";
import type { MacroDef, RepeatPayload, RepeatRow, RepeatValue, WidgetContext } from "../../registry-types";
import { chip, inlineOf, rowCity, rowLabel, rowValue, text, type Seg } from "../../registry-types";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow, pinnedCity } from "../../select";
import { renderRows } from "./rows";
import { formatKind } from "../../kinds";
import { clockIn, isKnownZone, noonIn, offsetMinutes } from "../../clock";
import { dayLabel } from "../../format";
import { readerClock, toClockLabel } from "../../clockLabel";
import { sunEvents, type SunTime } from "../../sun";

// The two clock widgets of M14 link 11 (widget brainstorm tier B): the sun on a
// day, and how far a day's clock is from home. Both are day primitives — entity
// `day`, the same `day` / `city` / `dates` filters as `day.rows` — so "the sun
// on day 3" and "the time difference in Kyoto" are bindings, not new widgets.
//
// **Everything about WHERE comes from the globals projection**: a day's
// `place` (its first located stop, in time order) and its `timeZone` are
// computed on the server, because the zone lookup is a boundary dataset that
// does not ship to the browser (M14 "Decided 2026-09-24"). This package only
// does arithmetic on the zone NAME with `Intl`. With no globals there is no
// place, which is `empty()` — the same honest degradation `city.detail` takes.
//
// "Local time there, now" is not here: it needs the current INSTANT, and
// `WidgetContext` carries only `today`, a date. Adding a clock to the context
// is a decision about Invariant 4 for another change.

const TIME_FILTERS = ["day", "city", "dates"] as const satisfies readonly FilterDimension[];
const TimeParams = filterParams(TIME_FILTERS);
type TimeParams = z.infer<typeof TimeParams>;

/**
 * A day's place and zone, when the server found both and this runtime knows the zone.
 *
 * `city` is the selection's pinned city (`pinnedCity`). The projection holds
 * ONE place per day — its first located stop — so on a Paris → Lyon travel day
 * it is Paris's, and the Lyon line of a city repeat must not print Paris's sun
 * under Lyon's name. That day is left out for Lyon rather than guessed: the
 * zone is not even the same on a London → New York day, and a second place per
 * day is a `TripGlobalsDay` contract change, not this widget's to make.
 */
function locatedDay(globals: TripGlobals, index: number, city: string | undefined) {
  const day = globals.days[index];
  if (!day?.place || !day.timeZone || !isKnownZone(day.timeZone)) return null;
  // The city of the stop that gave the place, never `cities[0]`: that can be
  // an earlier stop with a city and no coordinates, and would put its name on
  // another city's sunrise (CodeRabbit on #223). A pinned city is checked
  // against the same stop, for the same reason.
  const placeCity = day.place.city ?? null;
  if (city !== undefined && placeCity !== city) return null;
  return { place: day.place, zone: day.timeZone, city: placeCity };
}

// ---------------------------------------------------------------------------
// day.sun
// ---------------------------------------------------------------------------

/**
 * An instant as the day's local clock, in the reader's format, marked when
 * it falls on another date — Reykjavik's June sunset is at 12:03 am the next
 * morning, and printed bare it would read as a sunset before the sunrise.
 */
function clockOnDay(instant: number, zone: string, date: string, format: TimeFormat): string {
  const local = clockIn(zone, instant);
  const label = toClockLabel(local.time, format);
  if (local.date > date) return `${label} (next day)`;
  if (local.date < date) return `${label} (day before)`;
  return label;
}

/**
 * The golden hour, morning and evening: from sunrise until the sun is six
 * degrees up, and from six degrees back down until sunset (SunCalc's bounds,
 * and most photographers'). A sun that never climbs to six degrees is golden
 * all day; one that never drops below it has none. Under the midnight sun the
 * edges are the night's low point, so a part reads "until" / "from".
 */
function goldenHour(sun: ReturnType<typeof sunEvents>, clock: (t: number) => string): RepeatValue[] {
  const { sunrise, sunset, goldenMorningEnd: morningEnd, goldenEveningStart: eveningStart } = sun;
  if (morningEnd === "down" && eveningStart === "down") {
    return typeof sunrise === "number" ? [rowValue("golden hour all day")] : [];
  }
  const parts: string[] = [];
  if (typeof morningEnd === "number") {
    parts.push(typeof sunrise === "number" ? `${clock(sunrise)} – ${clock(morningEnd)}` : `until ${clock(morningEnd)}`);
  }
  if (typeof eveningStart === "number") {
    parts.push(typeof sunset === "number" ? `${clock(eveningStart)} – ${clock(sunset)}` : `from ${clock(eveningStart)}`);
  }
  return parts.length === 0 ? [] : [rowValue(`golden hour ${parts.join(" and ")}`)];
}

function sunCells(sun: ReturnType<typeof sunEvents>, clock: (t: number) => string): RepeatValue[][] {
  const edge = (label: string, t: SunTime) => (typeof t === "number" ? [rowValue(`${label} ${clock(t)}`)] : []);
  // Polar days take the sunrise column for the one fact there is, and leave
  // the sunset column open: a column that moves per row is not a column.
  if (sun.sunrise === "up" || sun.sunset === "up") {
    return [[rowValue("sun up all day")], [], goldenHour(sun, clock)];
  }
  if (sun.sunrise === "down" || sun.sunset === "down") return [[rowValue("sun down all day")], [], []];
  return [edge("sunrise", sun.sunrise), edge("sunset", sun.sunset), goldenHour(sun, clock)];
}

/**
 * `day.sun` — sunrise, sunset and the golden hour, one line per selected day,
 * in that day's local time at its first located stop.
 *
 * A day with no located stop is left out rather than printed as dashes: it has
 * no place to have a sun, and the rows are labelled "Day N" so the gap reads.
 * Undated located days are left out too, and if that is every day the empty
 * state says the fix is dates, not stops.
 */
export const daySun: MacroDef<TimeParams, RepeatPayload> = {
  name: "day.sun", title: "Sunrise and sunset", shape: "repeat",
  params: TimeParams, inputs: filterInputs(TIME_FILTERS),
  selection: { entity: "day", filters: TIME_FILTERS },
  description:
    "Sunrise, sunset and the golden hour for each selected day, in that day's local time, at its first stop with a place. Filter it to a day for that day's sun.",
  emptyText: "add a stop with a place to see this",
  // Fixed, never computed (ADR-037 decision 5).
  preview: "sunrise 4:25 am · sunset 7 pm · golden hour 6:22 pm – 7 pm",
  resolve: ({ trip, globals, user }: WidgetContext, params, item): MacroResult<RepeatPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    if (!globals) return empty();
    const city = pinnedCity(selection.value, item);
    const format = readerClock(user);
    let undated = false;
    const rows: RepeatRow[] = [];
    for (const index of selection.value.days) {
      const located = locatedDay(globals, index, city);
      if (!located) continue;
      const date = trip.days[index]!.date;
      if (date === null) {
        undated = true;
        continue;
      }
      const sun = sunEvents(date, located.place.lat, located.place.lng, located.zone);
      const clock = (t: number) => clockOnDay(t, located.zone, date, format);
      rows.push({
        lead: rowLabel(dayLabel(index)),
        cells: [located.city === null ? [] : [rowCity(located.city)], ...sunCells(sun, clock)],
      });
    }
    if (rows.length === 0) return undated ? empty("set the trip's dates to see this") : empty();
    return ok({ kind: "repeat-rows", rows });
  },
  render: renderRows,
};

// ---------------------------------------------------------------------------
// day.fromHome
// ---------------------------------------------------------------------------

/**
 * One place and how far its clock is from home: `minutes` ahead (negative
 * behind), and `amount` its size printed by `duration`'s one formatter
 * ("16h", "3h 30m") — not a second spelling of a duration.
 */
export interface HomeDifference {
  place: string;
  minutes: number;
  amount: string;
}

/** `"Asia/Tokyo"` → `"Tokyo"`, for a located day the geocoder gave no city. */
const zoneCity = (zone: string) => zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");

/**
 * The difference between two zones on a date, read at noon in the day's zone —
 * after any daylight-saving change that night, so it is the difference the day
 * is actually lived in.
 */
export function differenceOnDay(zone: string, home: string, date: string): number {
  const at = noonIn(zone, date);
  return offsetMinutes(zone, at) - offsetMinutes(home, at);
}

function sentenceOf(entry: HomeDifference): Seg[] {
  if (entry.minutes === 0) return [chip("city", entry.place), text(" keeps home time")];
  return [
    chip("city", entry.place),
    text(" is "),
    chip("value", entry.amount),
    text(entry.minutes > 0 ? " ahead of home" : " behind home"),
  ];
}

/**
 * `day.fromHome` — "Tokyo is 16h ahead of home", for the selected days.
 *
 * Home is the READER's: `TripGlobals.homeTimeZone`, from their account's home
 * airport. Unset, this is a quiet placeholder that says where to set it —
 * `empty` with a reason rather than `unbound`, because nothing on the widget's
 * own chrome can fix it; Account can.
 *
 * Read per day, so daylight saving on either side is the day's own. A day with
 * no date is read on `today` if the page knows it, since the difference is
 * still worth saying before the trip has dates. Each place is said once, in
 * trip order; the same place at two different differences (a trip that
 * straddles a clock change) is said twice, because both are true.
 */
export const dayFromHome: MacroDef<TimeParams, readonly HomeDifference[]> = {
  name: "day.fromHome", title: "Time difference from home", shape: "single",
  params: TimeParams, inputs: filterInputs(TIME_FILTERS),
  selection: { entity: "day", filters: TIME_FILTERS },
  description:
    "How far ahead of or behind home the selected days' local time is, from the reader's home airport. Filter it to a day for that day's difference.",
  emptyText: "add a stop with a place to see this",
  preview: "Tokyo is 16h ahead of home",
  resolve: ({ trip, globals, user, today }: WidgetContext, params, item) => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    if (!globals) return empty();
    const home = globals.homeTimeZone;
    if (!home || !isKnownZone(home)) {
      return empty(user?.homeAirport ? `no time zone known for ${user.homeAirport}` : "set a home airport in Account to see this");
    }
    const city = pinnedCity(selection.value, item);
    const entries: HomeDifference[] = [];
    const said = new Set<string>();
    for (const index of selection.value.days) {
      const located = locatedDay(globals, index, city);
      const date = trip.days[index]!.date ?? today;
      if (!located || date === null) continue;
      const minutes = differenceOnDay(located.zone, home, date);
      const entry = {
        place: located.city ?? zoneCity(located.zone),
        minutes,
        amount: formatKind("duration", Math.abs(minutes), { currency: trip.currency }),
      };
      const key = `${entry.place}|${entry.minutes}`;
      if (said.has(key)) continue;
      said.add(key);
      entries.push(entry);
    }
    return entries.length === 0 ? empty() : ok(entries);
  },
  render: (entries) => inlineOf(...entries.flatMap((entry, i) => [...(i === 0 ? [] : [text("; ")]), ...sentenceOf(entry)])),
};
