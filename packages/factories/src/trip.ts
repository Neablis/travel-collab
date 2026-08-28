import { Factory } from "fishery";
import { rollupCosts } from "@tc/domain";
import type { ActivityView, Location, Money, TimeWindow, TripDetail, TripMember } from "@tc/contracts";
import { faker } from "./seed";
import { uuidFrom } from "./ids";

// Small curated pools of real trip content, not faker.lorem — a 40-character
// lorem title hides real bugs (an overflowing card) that a real title would
// surface. Reused from the vocabulary apps/web/scripts/db-seed.ts and the
// old src/mocks/fixtures.ts already established.
const REAL_ACTIVITY_TITLES = [
  "Colosseum tour",
  "Roman Forum",
  "Vatican Museums",
  "Trevi Fountain at sunset",
  "Fushimi Inari shrine walk",
  "Nishiki Market food crawl",
  "Louvre — Denon wing",
  "Montmartre morning walk",
  "Sagrada Familia",
  "Park Güell",
  "Flight to Rome",
  "Train to Kyoto",
];

const REAL_LOCATIONS: Location[] = [
  { name: "Colosseum, Rome, Italy", city: "Rome", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
  { name: "Roman Forum, Rome, Italy", city: "Rome", lat: 41.8925, lng: 12.4853, countryCode: "IT" },
  { name: "Vatican Museums, Vatican City", city: "Vatican City", lat: 41.9029, lng: 12.4534, countryCode: "VA" },
  { name: "Fushimi Inari Taisha, Kyoto, Japan", city: "Kyoto", lat: 34.9671, lng: 135.7727, countryCode: "JP" },
  { name: "Nishiki Market, Kyoto, Japan", city: "Kyoto", lat: 35.005, lng: 135.7649, countryCode: "JP" },
  { name: "Musée du Louvre, Paris, France", city: "Paris", lat: 48.8606, lng: 2.3376, countryCode: "FR" },
  { name: "Sagrada Familia, Barcelona, Spain", city: "Barcelona", lat: 41.4036, lng: 2.1744, countryCode: "ES" },
];

export const moneyFactory = Factory.define<Money>(() => ({
  amountMinor: faker.number.int({ min: 500, max: 50_000 }),
  currency: "USD",
}));

export const locationFactory = Factory.define<Location>(() => ({
  ...faker.helpers.arrayElement(REAL_LOCATIONS),
}));

// Back-to-back one-hour windows walking the clock from 09:00, indexed by an
// activity's position *within its day* — the projection-side twin of
// `commands.ts`'s HOURLY_WINDOWS, and the same property both rely on:
// `windowsOverlap` (packages/domain/src/trip/conflicts.ts) is strict
// (`a.start < b.end && b.start < a.end`), so windows that merely touch at
// 10:00 do NOT conflict. Every activity used to get the identical literal
// 09:00-11:00 window, which made every `activitiesPerDay >= 2` fixture carry a
// degenerate mutual time clash on every day and left `scenarios.overlappingDay`
// indistinguishable from its siblings (KI-40).
//
// 23 distinct slots: every hour but 23:00, whose one-hour end would be the
// invalid "24:00" (`TimeWindow`'s HHMM regex stops at 23:59). The ladder wraps
// after that (index 14 lands at 00:00), so a single day carrying more than 23
// activities repeats a window and clashes again. Nothing comes near it — the
// widest fixture in the package is 12 activities per day (contract.test.ts) —
// and `trip.test.ts` pins the no-overlap property over the counts that exist.
const DAY_SLOT_COUNT = 23;
const padHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

export function hourlyWindow(indexWithinDay: number): TimeWindow {
  const startHour = (9 + indexWithinDay) % DAY_SLOT_COUNT;
  return { start: padHour(startHour), end: padHour(startHour + 1) };
}

type ActivityTransient = {
  /**
   * Position of this activity within its day. Selects its slot on the hourly
   * ladder above; defaults to 0 (09:00-10:00) so a bare `activityFactory.build()`
   * still reads like the first stop of a morning.
   */
  indexWithinDay: number;
};

export const activityFactory = Factory.define<ActivityView, ActivityTransient>(
  ({ sequence, transientParams }) => ({
    activityId: uuidFrom(sequence),
    title: faker.helpers.arrayElement(REAL_ACTIVITY_TITLES),
    timeWindow: hourlyWindow(transientParams.indexWithinDay ?? 0),
    location: null,
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
    cost: null,
  }),
);

export const tripMemberFactory = Factory.define<TripMember>(() => ({
  userId: "dev-alice",
  role: "owner",
}));

type TripTransient = {
  dayCount: number;
  activitiesPerDay: number;
  unscheduledCount: number;
  // false: no location at all. true: a full, geocoded REAL_LOCATIONS entry.
  // "named": a location with a name but no lat/lng — an AI-planned place
  // before geocoding enrichment runs (KI-15's actual shape), distinct from
  // having no location captured at all.
  located: boolean | "named";
  costed: boolean;
  budget: Money | null;
  currency: string;
  startDate: string | null;
  // Window for the i-th activity of each day, indexed by position within the
  // day. A hole or a short array falls back to `hourlyWindow(i)`, so a caller
  // states only the windows it actually cares about. This is the override
  // surface `scenarios.overlappingDay` uses to state a real partial overlap,
  // mirroring `commands.ts`'s `ScenarioSpec.timeWindows` on the command side.
  timeWindows: readonly (TimeWindow | undefined)[];
};

// The single highest-value factory in this package: every TripDetail it
// returns has internally-consistent rollups, because they are computed by
// @tc/domain's rollupCosts (the same function the real projection uses),
// never re-derived here. A fixture that drifts from the real rollup math is
// a bug the tests using it cannot see — see ADR-020.
export const tripDetailFactory = Factory.define<TripDetail, TripTransient>(
  ({ sequence, transientParams, afterBuild }) => {
    const {
      dayCount = 0,
      activitiesPerDay = 0,
      unscheduledCount = 0,
      located = false,
      costed = false,
      budget = null,
      currency = "USD",
      startDate = null,
      timeWindows = [],
    } = transientParams;

    const days = Array.from({ length: dayCount }, (_, dayIndex) => {
      const dayId = uuidFrom(sequence, 100 + dayIndex);
      // Offset by activitiesPerDay, not a fixed 10 — a fixed stride collides
      // once a day carries more than 10 activities (day 0's 11th activity and
      // day 1's 1st would both land on salt 1010), silently overwriting one
      // activity's entry in `activities` with the other's.
      const activityIds = Array.from({ length: activitiesPerDay }, (_, i) =>
        uuidFrom(sequence, 1000 + dayIndex * activitiesPerDay + i),
      );
      return { dayId, activityIds, date: startDate, costSubtotal: 0 };
    });

    const backlog = Array.from({ length: unscheduledCount }, (_, i) => uuidFrom(sequence, 5000 + i));

    let locationIndex = 0;
    const locationFor = (): ActivityView["location"] => {
      if (located === "named") return { name: REAL_LOCATIONS[locationIndex++ % REAL_LOCATIONS.length]!.name };
      if (located) return REAL_LOCATIONS[locationIndex++ % REAL_LOCATIONS.length]!;
      return null;
    };

    const activities: Record<string, ActivityView> = {};
    for (const day of days) {
      day.activityIds.forEach((activityId, i) => {
        activities[activityId] = activityFactory.build(
          {
            activityId,
            location: locationFor(),
            cost: costed ? moneyFactory.build({ currency }) : null,
            // Only an explicitly supplied window overrides the ladder; `undefined`
            // would win over the factory default, so the fallback is stated here.
            timeWindow: timeWindows[i] ?? hourlyWindow(i),
          },
          { transient: { indexWithinDay: i } },
        );
      });
    }
    // Backlog activities are on no day, so they can never clash with anything —
    // they still walk the ladder so a rack fixture does not read as a stack of
    // identical 09:00 stops.
    backlog.forEach((activityId, i) => {
      activities[activityId] = activityFactory.build(
        {
          activityId,
          cost: costed ? moneyFactory.build({ currency }) : null,
          timeWindow: hourlyWindow(i),
        },
        { transient: { indexWithinDay: i } },
      );
    });

    afterBuild((trip) => {
      const { dayCostSubtotals, unscheduledCostSubtotal, tripCostTotal } = rollupCosts(trip);
      trip.days = trip.days.map((day, i) => ({ ...day, costSubtotal: dayCostSubtotals[i] ?? 0 }));
      trip.unscheduledCostSubtotal = unscheduledCostSubtotal;
      trip.tripCostTotal = tripCostTotal;
      trip.budgetRemaining = trip.budget ? trip.budget.amountMinor - tripCostTotal : null;
      return trip;
    });

    return {
      tripId: uuidFrom(sequence),
      name: `${faker.helpers.arrayElement(["Rome", "Kyoto", "Paris", "Barcelona"])} ${2027 + (sequence % 3)}`,
      status: "active",
      startDate,
      currency,
      budget,
      members: [tripMemberFactory.build()],
      // Null by default: most fixtures are trips that started from nothing.
      // A clone's lineage is asserted directly where it matters (M11 link 5)
      // rather than generated, for the same reason non-owner roles are —
      // nothing a fixture replays produces one.
      forkedFrom: null,
      days,
      backlog,
      activities,
      conflicts: [],
      dismissedConflictIds: [],
      createdAt: "2026-07-08T12:00:00.000Z",
      unscheduledCostSubtotal: 0,
      tripCostTotal: 0,
      budgetRemaining: null,
    };
  },
);
