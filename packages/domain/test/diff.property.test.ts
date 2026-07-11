import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Anchor, TripCommand, TripEvent } from "@tc/contracts";
import {
  decideTripCommand,
  detectConflicts,
  diffTripStates,
  evolveTrip,
  tripStatesEqual,
  type TripState,
} from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const CTX = { actorId: "u1" };
const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DAY_IDS = [1, 2, 3].map((n) => uuid(100 + n));
const ACTIVITY_IDS = [1, 2, 3, 4, 5].map((n) => uuid(200 + n));
const WINDOWS = [null, { start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }] as const;
const LOCATIONS = [
  null,
  { name: "Rome", lat: 41.9, lng: 12.5 },
  { name: "NYC", lat: 40.7, lng: -74.0 },
] as const;
const ANCHORS: (Anchor[] | undefined)[] = [
  undefined,
  [{ kind: "dayOfWeek", days: ["mon", "tue", "wed", "thu", "fri"] }],
  [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }],
  [],
];
const COSTS = [undefined, null, { amountMinor: 1000, currency: "USD" }, { amountMinor: 250_00, currency: "USD" }] as const;
const CURRENCIES = ["USD", "EUR", "GBP"] as const;
const BUDGETS = [undefined, null, { amountMinor: 100_00, currency: "USD" }, { amountMinor: 500_00, currency: "USD" }] as const;

// One raw op = a tuple of small integers the builder interprets against the
// CURRENT state, so most generated commands are valid; invalid ones are
// simply skipped (decide rejects them — including no-ops).
type RawOp = { op: number; a: number; b: number; c: number };
const rawOp = fc.record({
  op: fc.integer({ min: 0, max: 9 }),
  a: fc.integer({ min: 0, max: 4 }),
  b: fc.integer({ min: 0, max: 4 }),
  c: fc.integer({ min: 0, max: 5 }),
});

function buildCommand(state: TripState, raw: RawOp): TripCommand | null {
  const day = state.days[raw.a % Math.max(1, state.days.length)];
  const activityIds = Object.keys(state.activities).sort();
  const activity = activityIds[raw.a % Math.max(1, activityIds.length)];
  switch (raw.op) {
    case 0:
      return { type: "AddDay", tripId: TRIP, dayId: DAY_IDS[raw.a % DAY_IDS.length]! };
    case 1:
      return day ? { type: "RemoveDay", tripId: TRIP, dayId: day.dayId } : null;
    case 2:
      return { type: "SetTripStartDate", tripId: TRIP, startDate: raw.a === 0 ? null : `2026-10-0${(raw.a % 9) + 1}` };
    case 3:
      return {
        type: "AddActivity",
        tripId: TRIP,
        activityId: ACTIVITY_IDS[raw.a % ACTIVITY_IDS.length]!,
        dayId: raw.b === 0 || !day ? undefined : day.dayId,
        title: `Activity ${raw.a}`,
        timeWindow: WINDOWS[raw.b % WINDOWS.length] ?? undefined,
        location: LOCATIONS[raw.c % LOCATIONS.length] ?? undefined,
        anchors: ANCHORS[raw.c % ANCHORS.length],
        cost: COSTS[raw.c % COSTS.length] ?? undefined,
      };
    case 4:
      return activity
        ? {
            type: "UpdateActivity",
            tripId: TRIP,
            activityId: activity,
            title: `Renamed ${raw.b}`,
            timeWindow: WINDOWS[raw.c % WINDOWS.length],
            anchors: ANCHORS[raw.b % ANCHORS.length],
            cost: COSTS[raw.b % COSTS.length],
          }
        : null;
    case 5:
      return activity
        ? {
            type: "MoveActivity",
            tripId: TRIP,
            activityId: activity,
            toDayId: raw.b === 0 || !day ? null : day.dayId,
            position: raw.c,
          }
        : null;
    case 6:
      return activity ? { type: "RemoveActivity", tripId: TRIP, activityId: activity } : null;
    case 7: {
      const live = detectConflicts(state).filter((c) => !state.dismissedConflictIds.includes(c.id));
      const target = live[raw.a % Math.max(1, live.length)];
      return target ? { type: "DismissConflict", tripId: TRIP, conflictId: target.id } : null;
    }
    case 8:
      return { type: "SetTripCurrency", tripId: TRIP, currency: CURRENCIES[raw.b % CURRENCIES.length]! };
    case 9:
      return { type: "SetTripBudget", tripId: TRIP, budget: BUDGETS[raw.b % BUDGETS.length] ?? null };
    default:
      return null;
  }
}

// Fold raw ops into a real, valid event history (starting with TripCreated).
function historyFrom(rawOps: RawOp[]): TripEvent[] {
  const events: TripEvent[] = [];
  let state: TripState | null = null;
  const create = decideTripCommand(null, { type: "CreateTrip", tripId: TRIP, name: "Prop trip" }, CTX);
  if (!create.ok) throw new Error("CreateTrip must succeed");
  for (const event of create.events) {
    events.push(event);
    state = evolveTrip(state, event);
  }
  for (const raw of rawOps) {
    const command = buildCommand(state!, raw);
    if (command === null) continue;
    const decision = decideTripCommand(state, command, CTX);
    if (!decision.ok) continue; // includes rejected no-ops — fine
    for (const event of decision.events) {
      events.push(event);
      state = evolveTrip(state, event);
    }
  }
  return events;
}

function foldTo(events: TripEvent[], count: number): TripState {
  let state: TripState | null = null;
  for (const event of events.slice(0, count)) state = evolveTrip(state, event);
  if (state === null) throw new Error("empty fold");
  return state;
}

describe("diffTripStates round-trip (THE M2 invariant)", () => {
  it("applying the diff to current reproduces the target exactly, for any history and any cut point", () => {
    fc.assert(
      fc.property(
        fc.array(rawOp, { minLength: 1, maxLength: 40 }),
        fc.nat(),
        (rawOps, cutSeed) => {
          const events = historyFrom(rawOps);
          const cut = (cutSeed % events.length) + 1; // 1..length
          const current = foldTo(events, events.length);
          const target = foldTo(events, cut);
          const diff = diffTripStates(current, target);
          let result = current;
          for (const event of diff) result = evolveTrip(result, event);
          expect(tripStatesEqual(result, target)).toBe(true);
          // conflicts are a pure function of state, so they match too:
          expect(detectConflicts(result)).toEqual(detectConflicts(target));
        },
      ),
      { numRuns: 300 },
    );
  });

  it("diff(x, x) is empty", () => {
    fc.assert(
      fc.property(fc.array(rawOp, { minLength: 1, maxLength: 30 }), (rawOps) => {
        const events = historyFrom(rawOps);
        const current = foldTo(events, events.length);
        expect(diffTripStates(current, current)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
