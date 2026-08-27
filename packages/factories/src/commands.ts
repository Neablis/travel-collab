import { randomUUID } from "node:crypto";
import type { Location, Money, TimeWindow, TripCommand } from "@tc/contracts";
import { scenarios } from "./scenarios";

type ScenarioName = keyof typeof scenarios;

/**
 * The fully-resolved shape a scenario expands into. Every field a command
 * stream needs is here and nothing is derived from a loop index: `timeWindows`
 * and `costs` are indexed by an activity's position *within its day*, and
 * `locations` is cycled across every activity the scenario emits (scheduled
 * first, then unscheduled).
 *
 * KI-41: this type is the override surface `commandsFor` did not have. Its
 * projection twin (`tripDetailFactory`/`activityFactory`, trip.ts) has taken
 * `Partial<TripDetail>` overrides all along; the command twin took only
 * `{ dayCount }`, so anything a test cared about — a time window above all —
 * had to be *invented* by the generator from `i`. Three separate patches came
 * out of that single fact (KI-37's `"010:00"`, its clamp, and a
 * scenario-name special case for `overlappingDay`); all three are deleted
 * now that a caller can simply say what it wants.
 */
export type ScenarioSpec = {
  /** Number of itinerary days. `0` means no `SetTripDates` command at all. */
  dayCount: number;
  /** Activities placed on each day. Must not exceed `timeWindows.length`. */
  activitiesPerDay: number;
  /** Activities left in the backlog (added but never moved onto a day). */
  unscheduledCount: number;
  /** `yyyy-mm-dd`. The end date is derived from this and `dayCount`. */
  startDate: string;
  /** Emitted as `SetTripBudget` when present, right after `SetTripDates`. */
  budget?: Money;
  /** Window for the i-th activity of a day. Indexed, never computed. */
  timeWindows: readonly TimeWindow[];
  /** Cost for the i-th activity of a day; a hole or short array means no cost. */
  costs: readonly (Money | undefined)[];
  /** Cycled across every activity in emission order; `[]` means unlocated. */
  locations: readonly Location[];
  /** Title of the i-th activity of day `dayIndex`. */
  title: (dayIndex: number, indexWithinDay: number) => string;
  /** Title of the i-th backlog activity. */
  unscheduledTitle: (index: number) => string;
};

/** What a caller may override. Anything omitted keeps the scenario's default. */
export type CommandsForOverrides = Partial<ScenarioSpec>;

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

// Real coordinates, so a map-rendering consumer gets somewhere plausible to
// fit its bounds to. Cycled by index across a scenario's activities.
const REAL_LOCATIONS: readonly Location[] = [
  { name: "Colosseum, Rome, Italy", city: "Rome", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
  { name: "Fushimi Inari Taisha, Kyoto, Japan", city: "Kyoto", lat: 34.9671, lng: 135.7727, countryCode: "JP" },
  { name: "Sagrada Familia, Barcelona, Spain", city: "Barcelona", lat: 41.4036, lng: 2.1744, countryCode: "ES" },
];

// Back-to-back hourly windows. `windowsOverlap` (packages/domain/src/trip/
// conflicts.ts) is strict — `a.start < b.end && b.start < a.end` — so windows
// that merely touch at 10:00 do NOT conflict. That is the property every
// scenario but `overlappingDay` relies on.
const HOURLY_WINDOWS: readonly TimeWindow[] = [
  { start: "09:00", end: "10:00" },
  { start: "10:00", end: "11:00" },
];

// `overlappingDay`'s whole point is a `time-overlap` conflict, so it states two
// genuinely *partially* overlapping windows outright rather than having the
// generator manufacture one by matching on the scenario's name (KI-41). A
// partial overlap exercises more of the rule than two identical windows would.
const OVERLAPPING_WINDOWS: readonly TimeWindow[] = [
  { start: "09:00", end: "10:00" },
  { start: "09:30", end: "10:30" },
];

const DEFAULT_DAY_COUNTS: Record<ScenarioName, number> = {
  emptyTrip: 0,
  threeDayTrip: 3,
  overBudgetTrip: 2,
  overlappingDay: 1,
  unscheduledHeavy: 2,
  mappedTrip: 5,
  ungeocodedTrip: 1,
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (base: Date, n: number) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};
/** Calendar arithmetic on a `yyyy-mm-dd` string, in UTC so it cannot drift across a DST boundary. */
const addIsoDays = (startDate: string, n: number) => {
  const [y, m, d] = startDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
};

const defaultTitle = (dayIndex: number, indexWithinDay: number) => `Stop ${dayIndex + 1}.${indexWithinDay + 1}`;
const defaultUnscheduledTitle = (index: number) => `Unscheduled stop ${index + 1}`;

/**
 * A scenario's defaults, with `dayCount` already resolved — `mappedTrip`'s
 * per-day coordinates depend on how many days it was asked for.
 */
function defaultSpec(scenario: ScenarioName, dayCount: number): ScenarioSpec {
  const base = {
    dayCount,
    startDate: iso(addDays(new Date(), 10)),
    title: defaultTitle,
    unscheduledTitle: defaultUnscheduledTitle,
    unscheduledCount: 0,
    costs: [] as readonly (Money | undefined)[],
    locations: [] as readonly Location[],
  };

  switch (scenario) {
    case "emptyTrip":
      return { ...base, activitiesPerDay: 0, timeWindows: [] };
    case "threeDayTrip":
      return {
        ...base,
        activitiesPerDay: 2,
        timeWindows: HOURLY_WINDOWS,
        costs: [usd(2500), usd(3600)],
        locations: REAL_LOCATIONS,
      };
    case "overBudgetTrip":
      return {
        ...base,
        activitiesPerDay: 2,
        timeWindows: HOURLY_WINDOWS,
        costs: [usd(2500), usd(3600)],
        budget: usd(1000),
      };
    case "overlappingDay":
      return { ...base, activitiesPerDay: 2, timeWindows: OVERLAPPING_WINDOWS };
    case "unscheduledHeavy":
      return {
        ...base,
        activitiesPerDay: 1,
        timeWindows: HOURLY_WINDOWS.slice(0, 1),
        unscheduledCount: 5,
        locations: REAL_LOCATIONS,
      };
    case "ungeocodedTrip":
      return { ...base, activitiesPerDay: 2, timeWindows: HOURLY_WINDOWS };
    // mappedTrip's output shape — title "Stop on day N", a fixed 09:00-10:00
    // window, one distinct lat/lng per day so each day's map fitBounds lands
    // somewhere different — is asserted on literally by e2e/m10-unscheduled-
    // rack.spec.ts, because this replaced the old hand-rolled createMappedTrip
    // (e2e/helpers.ts). It is expressed as defaults like every other scenario
    // rather than as a branch that skips the rest of the function, so a caller
    // can still override any part of it.
    case "mappedTrip":
      return {
        ...base,
        activitiesPerDay: 1,
        timeWindows: HOURLY_WINDOWS.slice(0, 1),
        title: (dayIndex) => `Stop on day ${dayIndex + 1}`,
        locations: Array.from({ length: dayCount }, (_, dayIndex) => ({
          name: `Place ${dayIndex + 1}`,
          city: `City ${dayIndex + 1}`,
          lat: 35 + dayIndex * 0.4,
          lng: 139 + dayIndex * 0.4,
          countryCode: "JP",
        })),
      };
  }
}

/** `{ ...defaults, ...overrides }` without letting an explicit `undefined` clobber a default. */
function applyOverrides(defaults: ScenarioSpec, overrides: CommandsForOverrides): ScenarioSpec {
  const set = Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
  return { ...defaults, ...set } as ScenarioSpec;
}

// The event-sourced counterpart to `scenarios`: unit tests want a TripDetail
// (a projection); integration tests, e2e, and db:seed need the ordered
// TripCommand[] that produces an equivalent one for real, because a
// directly-inserted row would silently diverge from replay (see ADR-020 and
// scripts/db-seed.ts's own header, which makes this argument first).
//
// `tripId` is supplied by the caller because the real creation flow mints it
// server-side (`POST /api/trips` -> `{ tripId }`, see apps/web/src/app/api/
// trips/route.ts) — these are the commands to run *after* that call, not
// including CreateTrip itself.
//
// The scenario name selects a set of defaults; `overrides` replaces any of them
// per call, the same way `scenarios.threeDayTrip(overrides)` does on the
// projection side (KI-41).
export function commandsFor(
  scenario: ScenarioName,
  tripId: string,
  overrides: CommandsForOverrides = {},
): TripCommand[] {
  const dayCount = overrides.dayCount ?? DEFAULT_DAY_COUNTS[scenario];
  const spec = applyOverrides(defaultSpec(scenario, dayCount), overrides);

  // Loud, not defensive. The old code clamped an invented start time at 22:00
  // so a window could never run past midnight, which meant a 14th activity on
  // a day silently received a duplicate 22:00-23:00 window (KI-41 item 2, the
  // KI-38 species). There is nothing to invent now: if a caller asks for more
  // activities per day than it supplied windows for, that is the caller's bug
  // and it says so here rather than emitting a plausible wrong answer.
  if (spec.activitiesPerDay > spec.timeWindows.length) {
    throw new RangeError(
      `commandsFor("${scenario}"): activitiesPerDay is ${spec.activitiesPerDay} but only ` +
        `${spec.timeWindows.length} timeWindow(s) were supplied. Pass a matching \`timeWindows\` override.`,
    );
  }

  const commands: TripCommand[] = [];
  const endDate = addIsoDays(spec.startDate, Math.max(spec.dayCount - 1, 0));
  const newDayIds = Array.from({ length: spec.dayCount }, () => randomUUID());

  if (spec.dayCount > 0) {
    commands.push({ type: "SetTripDates", tripId, startDate: spec.startDate, endDate, newDayIds });
  }

  if (spec.budget) {
    commands.push({ type: "SetTripBudget", tripId, budget: spec.budget });
  }

  // Cycled across every activity, scheduled ones first — shared, mutable
  // position, exactly as before.
  let locationIndex = 0;
  const nextLocation = (): Location | undefined =>
    spec.locations.length === 0 ? undefined : spec.locations[locationIndex++ % spec.locations.length];

  for (let dayIndex = 0; dayIndex < spec.dayCount; dayIndex++) {
    const dayId = newDayIds[dayIndex]!;
    for (let i = 0; i < spec.activitiesPerDay; i++) {
      const activityId = randomUUID();
      commands.push({
        type: "AddActivity",
        tripId,
        activityId,
        title: spec.title(dayIndex, i),
        timeWindow: spec.timeWindows[i]!,
        location: nextLocation(),
        cost: spec.costs[i],
      });
      commands.push({ type: "MoveActivity", tripId, activityId, toDayId: dayId, position: i });
    }
  }

  for (let i = 0; i < spec.unscheduledCount; i++) {
    commands.push({
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      title: spec.unscheduledTitle(i),
      location: nextLocation(),
    });
  }

  return commands;
}
