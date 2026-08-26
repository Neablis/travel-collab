import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "./trip";

// The states three or more unit tests build by hand today (Phase 0's
// inventory, "what it protects" column). Every scenario takes overrides and
// returns a fully-typed, self-consistent TripDetail — a test named "shows
// the over-budget banner" starts with `scenarios.overBudgetTrip()` and
// nothing else.
export const scenarios = {
  // No days — first-run / empty states.
  emptyTrip: (overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, { transient: { dayCount: 0, activitiesPerDay: 0 } }),

  // The ordinary case: three days, two activities each, located and costed.
  threeDayTrip: (overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, {
      transient: {
        dayCount: 3,
        activitiesPerDay: 2,
        located: true,
        costed: true,
        currency: "USD",
        startDate: "2027-06-01",
      },
    }),

  // budget < tripCostTotal → the over-budget conflict.
  overBudgetTrip: (overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, {
      transient: {
        dayCount: 2,
        activitiesPerDay: 2,
        costed: true,
        currency: "USD",
        budget: { amountMinor: 1000, currency: "USD" },
        startDate: "2027-06-01",
      },
    }),

  // Two activities on one day. Their windows already clash — `activityFactory`
  // gives every activity the same 09:00-11:00 window, and identical windows
  // satisfy `windowsOverlap`. The reason this scenario still reports no
  // conflict is that `tripDetailFactory` hardcodes `conflicts: []` and never
  // runs the conflict engine; the windows were never the missing piece. A
  // caller that wants populated conflicts sets them via `overrides.conflicts`,
  // or hydrates the fixture and calls `detectConflicts` itself. Note this
  // scenario is NOT distinguished from its `activitiesPerDay >= 2` siblings on
  // the projection side — see KI-40. The command-side twin,
  // `commandsFor("overlappingDay")`, does produce a real partial overlap.
  overlappingDay: (overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, {
      transient: { dayCount: 1, activitiesPerDay: 2, startDate: "2027-06-01" },
    }),

  // A populated backlog — the unscheduled rack.
  unscheduledHeavy: (overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, {
      transient: { dayCount: 2, activitiesPerDay: 1, unscheduledCount: 5, located: true },
    }),

  // Located activities across many days — the map rail (replaces the old
  // e2e-only createMappedTrip; see commandsFor("mappedTrip") for the
  // command-stream equivalent used through the real API).
  mappedTrip: (dayCount: number, overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, {
      transient: { dayCount, activitiesPerDay: 1, located: true, startDate: "2027-06-01" },
    }),

  // Locations with no lat/lng — KI-15 surfaces (an AI-planned location that
  // is still a guess, not a geocoded fact).
  ungeocodedTrip: (overrides: Partial<TripDetail> = {}): TripDetail =>
    tripDetailFactory.build(overrides, {
      transient: { dayCount: 1, activitiesPerDay: 2, located: "named", startDate: "2027-06-01" },
    }),
};
