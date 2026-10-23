// Where a trip is right now (ADR-080 decisions 1-3, M52 decisions 11, 12, 19):
// the one answer the Overview swap, a notebook's Today scope, Home's badge, the
// now-and-next widget and the assistant all read, so none of them works out a
// phase of its own.
//
// **Every stop time is local to its day's zone.** A `TimeWindow` is a bare
// `HH:MM`; the only zone a day has is the server's `TripGlobalsDay.timeZone`,
// from its first stop with coordinates. A day without one, and every day while
// the globals have not loaded, runs on the device's zone: a traveller whose
// phone has not changed zone sees times in the zone they left from until a stop
// is placed, which ADR-080 accepts.
//
// Pure (Invariant 4): the instant and the device's zone are handed in.
import type { ActivityView, TripDetail, TripGlobals } from "@tc/contracts";
import { clockIn, isKnownZone, offsetMinutes } from "./clock";
import { isoDaysBetween } from "./format";

/** How many days before the start date a trip is *soon* (M52 decision 19). */
export const SOON_DAYS = 3;

export type TripPhase = "planning" | "soon" | "underway" | "ended";

/** A timed stop placed in time: its window's ends as instants (ms since the epoch). */
export type TripNowStop = { activityId: string; dayId: string; start: number; end: number };

export type TripNow = {
  phase: TripPhase;
  /** Today's day, only while the trip is under way. */
  dayId: string | null;
  /** The stop whose window holds the instant; the latest to begin when two overlap. */
  current: TripNowStop | null;
  /** The first stop still to begin, on any day. */
  next: TripNowStop | null;
  /**
   * Today's date on the first day's clock, which the phase counts the days to
   * the start on, so a countdown beside it says the same; `null` when undated.
   */
  firstDayToday: string | null;
};

/** The instant, and the zone the device's clock is set to (`Intl…resolvedOptions().timeZone`). */
export type TripNowClock = { at: number; deviceZone: string };

type TripNowTrip = Pick<TripDetail, "days"> & {
  activities: Record<string, Pick<ActivityView, "timeWindow" | "kind" | "mode">>;
};
type TripNowGlobals = Pick<TripGlobals, "days"> | null;

/**
 * Where the trip is at `clock.at`: its phase, today's day while under way, and
 * the stop under way and the next one. Untimed stops have no place in time and
 * are never current or next.
 */
export function tripNow(trip: TripNowTrip, globals: TripNowGlobals, clock: TripNowClock): TripNow {
  const stops = timedStops(trip, globals, clock.deviceZone);
  const current = stops.filter((s) => s.start <= clock.at && clock.at < s.end).at(-1) ?? null;
  const next = stops.find((s) => s.start > clock.at) ?? null;

  const dated = trip.days.flatMap((day, index) => (day.date === null ? [] : [{ ...day, date: day.date, index }]));
  const first = dated[0];
  const last = dated.at(-1);
  if (first === undefined || last === undefined) return { phase: "planning", dayId: null, current, next, firstDayToday: null };
  // "Today" on each day's own clock, so the first day begins at midnight where
  // it is spent and the last ends at midnight there.
  const todayOn = (index: number) => clockIn(zoneOf(globals, index, clock.deviceZone), clock.at).date;

  const firstDayToday = todayOn(first.index);
  const toStart = isoDaysBetween(firstDayToday, first.date) ?? 0;
  if (toStart > SOON_DAYS) return { phase: "planning", dayId: null, current, next, firstDayToday };
  if (toStart > 0) return { phase: "soon", dayId: null, current, next, firstDayToday };
  if (todayOn(last.index) > last.date) return { phase: "ended", dayId: null, current, next, firstDayToday };
  // Days hand over in order: a day stays today until midnight ends it on its
  // own clock, and the next takes over once its own midnight has come too.
  // After a flight east the next day's midnight comes first, while tonight's
  // dinner is still ahead; after one west there is a gap in which neither
  // clock says the next day, and the day that has ended holds. The last day
  // has not ended by now, so some day has not.
  const at = dated.findIndex((day) => todayOn(day.index) <= day.date);
  const candidate = dated[at]!;
  const today = candidate.date <= todayOn(candidate.index) ? candidate : (dated[at - 1] ?? first);
  return { phase: "underway", dayId: today.dayId, current, next, firstDayToday };
}

/** The first flight still to leave, for Home's "Flight in 2 days, 7 h" — `null` with none, or none timed. */
export function nextFlight(trip: TripNowTrip, globals: TripNowGlobals, clock: TripNowClock): TripNowStop | null {
  return (
    timedStops(trip, globals, clock.deviceZone).find((s) => {
      const stop = trip.activities[s.activityId];
      return s.start > clock.at && stop?.kind === "transit" && stop.mode === "flight";
    }) ?? null
  );
}

/**
 * How long until something, as a countdown says it: "2 days, 7 h", "5 h" or
 * "42 min". Truncated, never rounded up, so a countdown does not reach a
 * figure before the time has.
 */
export function formatTimeUntil(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days} day${days === 1 ? "" : "s"}${hours > 0 ? `, ${hours} h` : ""}`;
  if (hours > 0) return `${hours} h`;
  return `${minutes} min`;
}

function zoneOf(globals: TripNowGlobals, index: number, deviceZone: string): string {
  const zone = globals?.days.find((day) => day.index === index)?.timeZone ?? null;
  // A name this runtime does not know degrades to the device's clock rather
  // than throwing on Home.
  return zone !== null && isKnownZone(zone) ? zone : deviceZone;
}

/**
 * Every timed stop on a dated day placed in time, earliest start first: the
 * one wall-time-to-instant reading a "last stop that has passed" or "today's
 * flights" is filtered from, rather than a second one.
 */
export function timedStops(trip: TripNowTrip, globals: TripNowGlobals, deviceZone: string): TripNowStop[] {
  return trip.days
    .flatMap((day, index) => {
      if (day.date === null) return [];
      const date = day.date;
      const zone = zoneOf(globals, index, deviceZone);
      return day.activityIds.flatMap((activityId) => {
        const window = trip.activities[activityId]?.timeWindow;
        if (window == null) return [];
        return [{ activityId, dayId: day.dayId, start: instantOf(zone, date, window.start), end: instantOf(zone, date, window.end) }];
      });
    })
    .sort((a, b) => a.start - b.start);
}

/**
 * The instant a wall clock in `zone` reads `time` on `date`. The offset is read
 * twice, the second time at the first guess, so a day that changes its clocks
 * settles on the offset in force at that wall time.
 */
function instantOf(zone: string, date: string, time: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const guess = wall - offsetMinutes(zone, wall) * 60_000;
  return wall - offsetMinutes(zone, guess) * 60_000;
}
