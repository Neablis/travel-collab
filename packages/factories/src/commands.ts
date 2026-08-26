import { randomUUID } from "node:crypto";
import type { TripCommand } from "@tc/contracts";
import { scenarios } from "./scenarios";

type ScenarioName = keyof typeof scenarios;

type CommandsForOptions = {
  dayCount?: number; // only meaningful for "mappedTrip", which takes its own dayCount
};

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
export function commandsFor(scenario: ScenarioName, tripId: string, options: CommandsForOptions = {}): TripCommand[] {
  const commands: TripCommand[] = [];
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (base: Date, n: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + n);
    return d;
  };

  const dayCounts: Record<ScenarioName, number> = {
    emptyTrip: 0,
    threeDayTrip: 3,
    overBudgetTrip: 2,
    overlappingDay: 1,
    unscheduledHeavy: 2,
    mappedTrip: options.dayCount ?? 5,
    ungeocodedTrip: 1,
  };
  const activitiesPerDay: Record<ScenarioName, number> = {
    emptyTrip: 0,
    threeDayTrip: 2,
    overBudgetTrip: 2,
    overlappingDay: 2,
    unscheduledHeavy: 1,
    mappedTrip: 1,
    ungeocodedTrip: 2,
  };
  const located = scenario === "threeDayTrip" || scenario === "unscheduledHeavy" || scenario === "mappedTrip";
  const costed = scenario === "threeDayTrip" || scenario === "overBudgetTrip";
  const unscheduledCount = scenario === "unscheduledHeavy" ? 5 : 0;

  const dayCount = dayCounts[scenario];
  const start = addDays(new Date(), 10);
  const end = addDays(start, Math.max(dayCount - 1, 0));
  const newDayIds = Array.from({ length: dayCount }, () => randomUUID());

  if (dayCount > 0) {
    commands.push({ type: "SetTripDates", tripId, startDate: iso(start), endDate: iso(end), newDayIds });
  }

  if (scenario === "overBudgetTrip") {
    commands.push({ type: "SetTripBudget", tripId, budget: { amountMinor: 1000, currency: "USD" } });
  }

  // mappedTrip's exact output shape (title "Stop on day N", a fixed 09:00-10:00
  // window, one distinct lat/lng per day so each day's map fitBounds lands
  // somewhere different) is asserted on literally by e2e/m10-unscheduled-
  // rack.spec.ts — this replaced the old hand-rolled createMappedTrip
  // (e2e/helpers.ts), so it has to reproduce that shape exactly, not the
  // generic per-scenario formula below.
  if (scenario === "mappedTrip") {
    for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
      const activityId = randomUUID();
      commands.push({
        type: "AddActivity",
        tripId,
        activityId,
        title: `Stop on day ${dayIndex + 1}`,
        timeWindow: { start: "09:00", end: "10:00" },
        location: {
          name: `Place ${dayIndex + 1}`,
          city: `City ${dayIndex + 1}`,
          lat: 35 + dayIndex * 0.4,
          lng: 139 + dayIndex * 0.4,
          countryCode: "JP",
        },
      });
      commands.push({ type: "MoveActivity", tripId, activityId, toDayId: newDayIds[dayIndex]!, position: 0 });
    }
    return commands;
  }

  // Activity `i` of a day gets a one-hour window starting at 09:00 + i. Both
  // components have to be zero-padded HH:MM — that is what the contract's
  // TimeWindow regex accepts, and a command that misses it comes back
  // `invalid-command` rather than as a wrong-but-usable time (KI-37: the old
  // `0${9 + i}:00` template only padded correctly for i === 0 and emitted
  // "010:00" from a day's second activity onward). The start hour is capped so
  // the window can never run past 23:00 however many activities a future
  // scenario asks for per day.
  const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  const timeWindowFor = (i: number) => {
    const startHour = Math.min(9 + i, 22);
    return { start: hhmm(startHour), end: hhmm(startHour + 1) };
  };

  let locationIndex = 0;
  const realLocations = [
    { name: "Colosseum, Rome, Italy", city: "Rome", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
    { name: "Fushimi Inari Taisha, Kyoto, Japan", city: "Kyoto", lat: 34.9671, lng: 135.7727, countryCode: "JP" },
    { name: "Sagrada Familia, Barcelona, Spain", city: "Barcelona", lat: 41.4036, lng: 2.1744, countryCode: "ES" },
  ];

  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const dayId = newDayIds[dayIndex]!;
    for (let i = 0; i < activitiesPerDay[scenario]; i++) {
      const activityId = randomUUID();
      commands.push({
        type: "AddActivity",
        tripId,
        activityId,
        title: `Stop ${dayIndex + 1}.${i + 1}`,
        timeWindow: timeWindowFor(i),
        location: located ? realLocations[locationIndex++ % realLocations.length] : undefined,
        cost: costed ? { amountMinor: 2500 + i * 1100, currency: "USD" } : undefined,
      });
      commands.push({ type: "MoveActivity", tripId, activityId, toDayId: dayId, position: i });
    }
  }

  for (let i = 0; i < unscheduledCount; i++) {
    commands.push({
      type: "AddActivity",
      tripId,
      activityId: randomUUID(),
      title: `Unscheduled stop ${i + 1}`,
      location: located ? realLocations[locationIndex++ % realLocations.length] : undefined,
    });
  }

  return commands;
}
