import type { ActivityView, TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";

// One trip that every filter dimension has something to bite on, so the
// primitives' tests argue about behaviour rather than about setup.
//
// **The costs are the factory's and are never touched.** `tripDetailFactory`
// computes `costSubtotal`, `unscheduledCostSubtotal` and `tripCostTotal` with
// `@tc/domain`'s own `rollupCosts` (AGENTS.md: *"data comes from
// `@tc/factories`, never a hand-built rollup"*), and ADR-039's central cost
// claim is that a wide `cost` EQUALS `tripCostTotal` and a day-bound one equals
// that day's `costSubtotal`. Patching an amount here would make those
// assertions circular — this fixture would be asserting against arithmetic this
// file did. So the patch below touches dates, kinds, tags, locations and time
// windows, none of which enter a cost rollup, and every cost assertion compares
// against the trip's own totals rather than against a literal.
//
// The globals are a hand-written LITERAL rather than a second implementation of
// `buildTripGlobals`: that function lives in `apps/web/src/server` because it
// imports `@tc/domain`, which this package may not, and reimplementing
// `citiesOfDay` here to generate a fixture is how the fixture and the real
// projection come to disagree. Written out, it is data that can be read against
// the trip above it.
//
// Shape, and what each part is for:
//
//   Day 1  2027-06-01  Rome            s0 booked/ticketed, located Rome
//                                      s1 planned/meal, UNLOCATED  ← the day fallback
//   Day 2  2027-06-02  Rome → Kyoto    s2 transit, located Rome    ← a travel day
//                                      s3 booked/lodging, located Kyoto, no time
//   Day 3  no date     —               s4 planned, s5 idea/outdoors, neither located
//   Backlog                            b0 idea, located Kyoto      ← in the wide set,
//                                                                     out of every dated one
export interface SelectionTrip {
  trip: TripDetail;
  globals: TripGlobals;
  /** The stop ids, in the order described above, so a test can name one. */
  ids: { s0: string; s1: string; s2: string; s3: string; s4: string; s5: string; b0: string };
}

export function selectionTrip(): SelectionTrip {
  const trip = tripDetailFactory.build(
    {},
    {
      transient: {
        dayCount: 3,
        activitiesPerDay: 2,
        unscheduledCount: 1,
        costed: true,
        currency: "USD",
        startDate: "2027-06-01",
        // A budget, so `attribute{field: trip.budgetRemaining}` has something
        // to read. Comfortably above the factory's costs, because "over
        // budget" is its own case and a fixture that is accidentally over it
        // would make an unrelated test read as a bug.
        budget: { amountMinor: 5_000_00, currency: "USD" },
      },
    },
  );

  const [s0, s1] = trip.days[0]!.activityIds as [string, string];
  const [s2, s3] = trip.days[1]!.activityIds as [string, string];
  const [s4, s5] = trip.days[2]!.activityIds as [string, string];
  const b0 = trip.backlog[0]!;

  // `startDate` gives every day the same date, which no real trip has. Dates
  // select days, so a fixture where they cannot tell days apart would let a
  // broken date filter pass.
  trip.days[0]!.date = "2027-06-01";
  trip.days[1]!.date = "2027-06-02";
  trip.days[2]!.date = null;

  const patch = (id: string, fields: Partial<ActivityView>) => {
    trip.activities[id] = { ...trip.activities[id]!, ...fields };
  };
  patch(s0, {
    title: "Colosseum",
    kind: "booked", tags: ["ticketed"],
    location: { name: "Colosseum, Rome, Italy", city: "Rome" },
    timeWindow: { start: "09:00", end: "10:00" },
  });
  patch(s1, {
    title: "Lunch",
    kind: "planned", tags: ["meal"],
    location: null,
    timeWindow: { start: "12:00", end: "13:00" },
  });
  patch(s2, {
    title: "Train to Kyoto",
    kind: "transit", tags: [],
    location: { name: "Roma Termini", city: "Rome" },
    timeWindow: { start: "06:00", end: "14:00" },
  });
  patch(s3, {
    title: "Ryokan",
    kind: "booked", tags: ["lodging"],
    location: { name: "Ryokan Kyoto", city: "Kyoto" },
    timeWindow: null,
  });
  patch(s4, { title: "Free morning", kind: "planned", tags: [], location: null, timeWindow: null });
  patch(s5, { title: "Maybe a hike", kind: "idea", tags: ["outdoors"], location: null, timeWindow: null });
  patch(b0, {
    title: "Souvenirs",
    kind: "idea", tags: [],
    location: { name: "Nishiki Market", city: "Kyoto" },
    timeWindow: null,
  });

  const globals: TripGlobals = {
    days: [
      { index: 0, date: "2027-06-01", cities: ["Rome"], activityCount: 2, costSubtotal: trip.days[0]!.costSubtotal },
      // Two cities, in arrival order — the travel day `citiesOfDay` orders by time.
      { index: 1, date: "2027-06-02", cities: ["Rome", "Kyoto"], activityCount: 2, costSubtotal: trip.days[1]!.costSubtotal },
      { index: 2, date: null, cities: [], activityCount: 2, costSubtotal: trip.days[2]!.costSubtotal },
    ],
    // Stop counts are by the stop's OWN city, days by which days touch it —
    // exactly how `buildTripGlobals` accumulates them. Rome: s0 and s2. Kyoto:
    // s3 and the backlog's b0, which is why Kyoto's count exceeds what its one
    // day holds.
    cities: [
      { name: "Rome", dayIndexes: [0, 1], activityCount: 2 },
      { name: "Kyoto", dayIndexes: [1], activityCount: 2 },
    ],
    tags: [
      { tag: "ticketed", activityCount: 1 },
      { tag: "meal", activityCount: 1 },
      { tag: "lodging", activityCount: 1 },
      { tag: "outdoors", activityCount: 1 },
    ],
    bookedCount: 2,
  };

  return { trip, globals, ids: { s0, s1, s2, s3, s4, s5, b0 } };
}
