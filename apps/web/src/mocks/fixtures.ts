import type { Page, TripDetail, TripHistory } from "@tc/contracts";

export function tripDetailFixture(overrides: Partial<TripDetail> = {}): TripDetail {
  return {
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    name: "Rome 2027",
    startDate: null,
    currency: "USD",
    budget: null,
    members: [{ userId: "dev-alice", role: "owner" }],
    days: [],
    backlog: [],
    activities: {},
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2026-07-08T12:00:00.000Z",
    unscheduledCostSubtotal: 0,
    tripCostTotal: 0,
    budgetRemaining: null,
    ...overrides,
  };
}

// A costed sample: one day with two costed activities, one costed backlog
// activity, a trip currency/budget set, and rollups computed by hand — for
// the itinerary/daily/full-trip overview lenses to have something to show.
export function costedTripDetailFixture(): TripDetail {
  const dayId = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
  const colosseumId = "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e";
  const forumId = "3d4e5f60-7182-4c9d-0e1f-2a3b4c5d6e7f";
  const flightId = "4e5f6071-8293-4d0e-1f2a-3b4c5d6e7f80";

  const colosseumCost = { amountMinor: 2500, currency: "USD" };
  const forumCost = { amountMinor: 1600, currency: "USD" };
  const flightCost = { amountMinor: 45000, currency: "USD" };

  const daySubtotal = colosseumCost.amountMinor + forumCost.amountMinor;
  const unscheduledCostSubtotal = flightCost.amountMinor;
  const tripCostTotal = daySubtotal + unscheduledCostSubtotal;
  const budget = { amountMinor: 100000, currency: "USD" };

  return tripDetailFixture({
    startDate: "2027-06-01",
    currency: "USD",
    budget,
    days: [{ dayId, activityIds: [colosseumId, forumId], date: "2027-06-01", costSubtotal: daySubtotal }],
    backlog: [flightId],
    activities: {
      [colosseumId]: {
        activityId: colosseumId,
        title: "Colosseum tour",
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Colosseum, Rome, Italy", lat: 41.8902, lng: 12.4922, countryCode: "IT" },
        notes: null,
        anchors: [],
        cost: colosseumCost,
      },
      [forumId]: {
        activityId: forumId,
        title: "Roman Forum",
        timeWindow: { start: "11:30", end: "13:00" },
        location: { name: "Roman Forum, Rome, Italy", lat: 41.8925, lng: 12.4853, countryCode: "IT" },
        notes: null,
        anchors: [],
        cost: forumCost,
      },
      [flightId]: {
        activityId: flightId,
        title: "Flight to Rome",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        cost: flightCost,
      },
    },
    unscheduledCostSubtotal,
    tripCostTotal,
    budgetRemaining: budget.amountMinor - tripCostTotal,
  });
}

export function pageFixture(overrides: Partial<Page> = {}): Page {
  return {
    id: "7f8a9b0c-1d2e-4f3a-8b4c-5d6e7f8a9b0c",
    tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f",
    title: "Trip Overview",
    context: { tripId: "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f" },
    content: { type: "doc", content: [] },
    createdAt: "2026-07-08T12:00:00.000Z",
    updatedAt: "2026-07-08T12:00:00.000Z",
    actorId: "dev-alice",
    ...overrides,
  };
}

export const sampleGeocodeResults = [
  { lat: 41.8902, lng: 12.4922, canonicalName: "Colosseum, Rome, Italy", countryCode: "IT" },
  { lat: 41.9029, lng: 12.4534, canonicalName: "Vatican Museums, Vatican City", countryCode: "VA" },
];

// Newest first: an undo entry, the undone "add to backlog" entry, then the
// creation entry — matches how the real history endpoint orders things.
export function historyFixture(tripId: string): TripHistory {
  return {
    tripId,
    canUndo: true,
    canRedo: true,
    entries: [
      {
        batchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a83",
        fromSeq: 2,
        toSeq: 2,
        actorId: "dev-alice",
        occurredAt: "2026-07-08T12:02:00.000Z",
        origin: { kind: "undo", undoesBatchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a82" },
        description: 'Undid: Added "Colosseum" to the backlog',
        undone: false,
      },
      {
        batchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a82",
        fromSeq: 2,
        toSeq: 2,
        actorId: "dev-alice",
        occurredAt: "2026-07-08T12:01:00.000Z",
        origin: { kind: "user" },
        description: 'Added "Colosseum" to the backlog',
        undone: true,
      },
      {
        batchId: "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81",
        fromSeq: 1,
        toSeq: 1,
        actorId: "dev-alice",
        occurredAt: "2026-07-08T12:00:00.000Z",
        origin: { kind: "user" },
        description: 'Created trip "Rome 2027"',
        undone: false,
      },
    ],
  };
}
