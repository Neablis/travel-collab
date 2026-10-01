import { z } from "zod";
import type { FilterDimension, TimeFormat, TripGlobals } from "@tc/contracts";
import type { MacroDef, WidgetContext, WidgetInput } from "../../registry-types";
import { blockOf, chip, inlineOf, text, type Seg } from "../../registry-types";
import type { SunAxis, SunPayload, SunRow } from "../../sunPayload";
import { ok, empty, needsTrip, type MacroResult } from "../../result";
import { filterInputs, filterParams } from "../../filters";
import { narrow, pinnedCity } from "../../select";
import { formatKind } from "../../kinds";
import { clockIn, isKnownZone, noonIn, offsetMinutes } from "../../clock";
import { dayLabel } from "../../format";
import { readerClock, toClockLabel } from "../../clockLabel";
import { sunEvents, type SunEvents, type SunTime } from "../../sun";

// The two clock widgets of M14 link 11 (widget brainstorm tier B): the sun on a
// day, and how far a day's clock is from home. Both are day primitives — entity
// `day`, the same `day` / `city` / `dates` filters as `day.rows` — so "the sun
// on day 3" and "the time difference in Kyoto" are bindings, not new widgets.
//
// The sun is a BLOCK (`SunPayload`): a ribbon of daylight per day on one shared
// clock, or the same rows as a table. The difference from home is a sentence.
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

const SunParams = filterParams(TIME_FILTERS, { view: z.enum(["graphic", "table"]).optional() });
type SunParams = z.infer<typeof SunParams>;

const SUN_INPUTS: readonly WidgetInput[] = [
  ...filterInputs(TIME_FILTERS),
  {
    name: "view", type: "choice", label: "Show as", default: "graphic",
    options: [{ value: "graphic", label: "Graphic" }, { value: "table", label: "Table" }],
  },
];

const DAY_MINUTES = 1440;

/**
 * An instant on the day's local clock: the minutes after THAT day's midnight
 * the graphic draws from, and the label a reader sees — in their format, marked
 * when it falls on another date. Reykjavik's June sunset is at 12:03 am the
 * next morning: printed bare it would read as a sunset before the sunrise, and
 * as a bare minute it would draw one.
 */
function onDay(instant: number, zone: string, date: string, format: TimeFormat): { minute: number; label: string } {
  const local = clockIn(zone, instant);
  const [hours, minutes] = local.time.split(":").map(Number);
  const daysOff = Math.round((Date.parse(local.date) - Date.parse(date)) / 86_400_000);
  const clock = toClockLabel(local.time, format);
  return {
    minute: hours! * 60 + minutes! + DAY_MINUTES * daysOff,
    label: daysOff > 0 ? `${clock} (next day)` : daysOff < 0 ? `${clock} (day before)` : clock,
  };
}

/**
 * One day's row. A polar day takes its state from whichever edge the sun never
 * crosses, and has no times: there are no two to print.
 *
 * The golden hours are where the sun is under six degrees (`sun.ts`); a sun
 * that never climbs that high, or never drops that low, has no edge to draw.
 */
function sunRow(
  sun: SunEvents, index: number, city: string | null, at: (t: number) => { minute: number; label: string }, currency: string,
): SunRow {
  const minuteOf = (t: SunTime) => (typeof t === "number" ? at(t).minute : null);
  const base = {
    key: String(index), label: dayLabel(index), city,
    goldenMorningEndMinute: minuteOf(sun.goldenMorningEnd),
    goldenEveningStartMinute: minuteOf(sun.goldenEveningStart),
  };
  const none = { sunriseMinute: null, sunsetMinute: null, sunrise: null, sunset: null };
  if (sun.sunrise === "up" || sun.sunset === "up") return { ...base, ...none, state: "up-all-day", daylight: "24h" };
  if (sun.sunrise === "down" || sun.sunset === "down") return { ...base, ...none, state: "down-all-day", daylight: "0h" };
  const sunrise = at(sun.sunrise);
  const sunset = at(sun.sunset);
  return {
    ...base, state: "normal",
    sunriseMinute: sunrise.minute, sunsetMinute: sunset.minute, sunrise: sunrise.label, sunset: sunset.label,
    daylight: formatKind("duration", Math.round((sun.sunset - sun.sunrise) / 60_000), { currency }),
  };
}

// The design's clock: 5 am to 6 pm, a tick every three hours.
const AXIS_BASE = { start: 300, end: 1080, step: 180 } as const;

function tickLabel(minute: number, format: TimeFormat): string {
  const hour = (minute / 60) % 24;
  if (format === "24h") return toClockLabel(`${hour}:00`, format);
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return `${hour % 12}${hour < 12 ? "a" : "p"}`;
}

/**
 * One clock for the whole block. The base range holds an ordinary day; it
 * widens, by whole hours, to the trip's earliest sunrise and latest sunset, and
 * never past the day itself — a sunset after midnight clamps to the axis's end
 * and keeps its "(next day)" label. A sun up all day is drawn across all of it.
 */
function axisOf(rows: readonly SunRow[], format: TimeFormat): SunAxis {
  const rises = rows.flatMap((row) => (row.sunriseMinute === null ? [] : [row.sunriseMinute]));
  const sets = rows.flatMap((row) => (row.sunsetMinute === null ? [] : [row.sunsetMinute]));
  const allDay = rows.some((row) => row.state === "up-all-day");
  const startMinute = allDay ? 0 : Math.max(0, Math.min(AXIS_BASE.start, ...rises.map((m) => Math.floor(m / 60) * 60)));
  const endMinute = allDay
    ? DAY_MINUTES
    : Math.min(DAY_MINUTES, Math.max(AXIS_BASE.end, ...sets.map((m) => Math.ceil(m / 60) * 60)));
  const ticks = [];
  for (let minute = 0; minute <= DAY_MINUTES; minute += AXIS_BASE.step) {
    if (minute >= startMinute && minute <= endMinute) ticks.push({ minute, label: tickLabel(minute, format) });
  }
  return { startMinute, endMinute, ticks };
}

/**
 * `day.sun` — sunrise, sunset and the length of the day, one row per selected
 * day, in that day's local time at its first located stop. The golden hour is
 * drawn on the ribbon, not written.
 *
 * A day with no located stop is left out rather than printed as dashes: it has
 * no place to have a sun, and the rows are labelled "Day N" so the gap reads.
 * Undated located days are left out too, and if that is every day the empty
 * state says the fix is dates, not stops.
 */
export const daySun: MacroDef<SunParams, SunPayload> = {
  name: "day.sun", title: "Sunrise and sunset", shape: "block",
  params: SunParams, inputs: SUN_INPUTS,
  selection: { entity: "day", filters: TIME_FILTERS },
  description:
    "Sunrise, sunset and the length of the day for each selected day, in that day's local time, at its first stop with a place — drawn as a ribbon of daylight with the golden hour marked on it, or as a table. Filter it to a day for that day's sun.",
  emptyText: "add a stop with a place to see this",
  // Fixed, never computed (ADR-037 decision 5).
  preview: "a ribbon of daylight for each day, sunrise to sunset",
  resolve: ({ trip, globals, user }: WidgetContext, params, item): MacroResult<SunPayload> => {
    if (!trip) return needsTrip();
    const selection = narrow(trip, globals, params, item);
    if (selection.status !== "ok") return selection;
    if (!globals) return empty();
    const city = pinnedCity(selection.value, item);
    const format = readerClock(user);
    let undated = false;
    const rows: SunRow[] = [];
    for (const index of selection.value.days) {
      const located = locatedDay(globals, index, city);
      if (!located) continue;
      const date = trip.days[index]!.date;
      if (date === null) {
        undated = true;
        continue;
      }
      const sun = sunEvents(date, located.place.lat, located.place.lng, located.zone);
      rows.push(sunRow(sun, index, located.city, (t) => onDay(t, located.zone, date, format), trip.currency));
    }
    if (rows.length === 0) return undated ? empty("set the trip's dates to see this") : empty();
    return ok({
      kind: "sun",
      view: params.view ?? "graphic",
      axis: axisOf(rows, format),
      rows,
      summary: `Sunrise and sunset for ${rows.length} ${rows.length === 1 ? "day" : "days"}.`,
    });
  },
  render: blockOf,
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
