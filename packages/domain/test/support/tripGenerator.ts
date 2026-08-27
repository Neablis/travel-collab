// Shared random-trip generator for the domain's property tests.
//
// One raw op = a tuple of small integers interpreted against the CURRENT state,
// so most generated commands are valid; the ones that aren't are skipped
// (`decide` rejects them, including no-ops). Extracted from
// `diff.property.test.ts` so every property test explores the same input space
// and shares one set of health counters — a generator that quietly stops
// producing valid commands would otherwise degrade each test in isolation and
// invisibly.
import fc from "fast-check";
import type { Anchor, TripCommand, TripEvent, TripLineage } from "@tc/contracts";
import { decideTripCommand, detectConflicts, evolveTrip, type TripState } from "../../src";

export const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

/**
 * A lineage pointer, or null. Genesis-only, so it can never be reached by
 * replaying raw ops — see `historyFrom`'s comment.
 */
export const arbLineage: fc.Arbitrary<TripLineage | null> = fc.option(
  fc.record({
    tripId: fc.constant("7d9a1f8e-0000-4000-8000-00000000000b"),
    atSeq: fc.integer({ min: 1, max: 200 }),
    name: fc.string({ minLength: 1, maxLength: 40 }),
  }),
  { nil: null },
);
export const CTX = { actorId: "u1" };
export const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
// kind/tags must appear in the generated input space, or every property test
// that folds these commands passes while never once producing either field —
// green and vacuous. See support/witness.ts for why that is called out.
const KINDS = [undefined, "planned", "booked", "hold", "idea", "transit"] as const;
const TAGS = [undefined, [], ["meal"], ["lodging", "ticketed"], ["outdoors"]] as const;
const CURRENCIES = ["USD", "EUR", "GBP"] as const;
const BUDGETS = [undefined, null, { amountMinor: 100_00, currency: "USD" }, { amountMinor: 500_00, currency: "USD" }] as const;
const TRIP_NAMES = ["Renamed A", "Renamed B"] as const;

export type RawOp = { op: number; a: number; b: number; c: number };

export const rawOp = fc.record({
  op: fc.integer({ min: 0, max: 12 }),
  a: fc.integer({ min: 0, max: 4 }),
  b: fc.integer({ min: 0, max: 4 }),
  c: fc.integer({ min: 0, max: 5 }),
});

export function buildCommand(state: TripState, raw: RawOp): TripCommand | null {
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
        kind: KINDS[raw.b % KINDS.length],
        tags: TAGS[raw.c % TAGS.length]?.slice(),
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
            kind: KINDS[raw.c % KINDS.length],
            tags: TAGS[raw.a % TAGS.length]?.slice(),
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
    case 10: {
      // Include the current name sometimes so a same-name rename (a no-op at
      // the domain level) is exercised too, not just always-different names.
      const candidates = [TRIP_NAMES[0]!, TRIP_NAMES[1]!, state.name];
      return { type: "SetTripName", tripId: TRIP, name: candidates[raw.b % candidates.length]! };
    }
    case 11:
      return { type: "DeleteTrip", tripId: TRIP };
    case 12:
      return { type: "RestoreTrip", tripId: TRIP };
    default:
      return null;
  }
}

// Generator health. `historyFrom` drops two kinds of input on the floor: raw
// tuples `buildCommand` can't turn into a command, and commands `decide`
// rejects. Both are necessary — most random tuples aren't valid commands — but
// they make the *actually explored* input space invisible. If a future change
// to `buildCommand`, `decide`, or the contracts pushed the acceptance rate
// toward zero, every property built on this generator would keep reporting ✓
// while exercising almost nothing. `generator-health.test.ts` asserts on these.
export const generator = { built: 0, accepted: 0 };

export function resetGeneratorCounters(): void {
  generator.built = 0;
  generator.accepted = 0;
}

/**
 * Fold raw ops into a real, valid event history (starting with TripCreated).
 *
 * `forkedFrom` is a parameter rather than a hardcoded `null` because no raw op
 * can produce one: lineage is set at genesis and no command touches it, so a
 * generator that always passed null would let every property built on this
 * pass while never once seeing a forked trip — the same trap M18 PR 1's
 * changelog names for hand-enumerated fields (M11 link 5).
 */
export function historyFrom(rawOps: RawOp[], forkedFrom: TripLineage | null = null): TripEvent[] {
  const events: TripEvent[] = [];
  let state: TripState | null = null;
  const create = decideTripCommand(null, { type: "CreateTrip", tripId: TRIP, name: "Prop trip", forkedFrom }, CTX);
  if (!create.ok) throw new Error("CreateTrip must succeed");
  for (const event of create.events) {
    events.push(event);
    state = evolveTrip(state, event);
  }
  for (const raw of rawOps) {
    const command = buildCommand(state!, raw);
    if (command === null) continue;
    generator.built += 1;
    const decision = decideTripCommand(state, command, CTX);
    if (!decision.ok) continue; // includes rejected no-ops — fine
    generator.accepted += 1;
    for (const event of decision.events) {
      events.push(event);
      state = evolveTrip(state, event);
    }
  }
  return events;
}

/** Every intermediate state a history passes through, including the last. */
export function statesFrom(rawOps: RawOp[]): TripState[] {
  const states: TripState[] = [];
  let state: TripState | null = null;
  for (const event of historyFrom(rawOps)) {
    state = evolveTrip(state, event);
    states.push(state);
  }
  return states;
}

export function foldTo(events: TripEvent[], count: number): TripState {
  let state: TripState | null = null;
  for (const event of events.slice(0, count)) state = evolveTrip(state, event);
  if (state === null) throw new Error("empty fold");
  return state;
}
