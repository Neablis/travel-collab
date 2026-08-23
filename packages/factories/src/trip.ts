import { Factory } from "fishery";
import { rollupCosts } from "@tc/domain";
import type { ActivityView, Location, Money, TripDetail, TripMember } from "@tc/contracts";
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

export const activityFactory = Factory.define<ActivityView>(({ sequence }) => ({
  activityId: uuidFrom(sequence),
  title: faker.helpers.arrayElement(REAL_ACTIVITY_TITLES),
  timeWindow: { start: "09:00", end: "11:00" },
  location: null,
  notes: null,
  anchors: [],
  cost: null,
}));

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
      for (const activityId of day.activityIds) {
        activities[activityId] = activityFactory.build({
          activityId,
          location: locationFor(),
          cost: costed ? moneyFactory.build({ currency }) : null,
        });
      }
    }
    for (const activityId of backlog) {
      activities[activityId] = activityFactory.build({
        activityId,
        cost: costed ? moneyFactory.build({ currency }) : null,
      });
    }

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
