import { z } from "zod";
import { ActivityTagDescribed } from "@tc/contracts";

/**
 * **What rides the navigation into a new trip** (ADR-084 §5, M56 D5).
 *
 * Two hops, two records, both `pendingPlaybookAdd.ts`'s shape: banked in the
 * browser with a max age, read-and-clear, so a StrictMode double effect or a
 * remount finds nothing the second time.
 *
 * 1. **Home's hand-off to New trip**: what mapped onto the picker's fields
 *    (`prefill`), and the asks only a trip can do. Taken when New trip opens.
 * 2. **What New trip leaves for the trip it made**: *Plan with AI*'s kickoff,
 *    and the carried asks. Keyed to the trip, and taken by its board, which
 *    sends the kickoff and shows each ask as a chip that runs only when pressed.
 *
 * Every field is held to what the picker and the rail can show: a forged record
 * (same-origin script) can do no more than prefill a picker or offer a chip the
 * person still has to press.
 */

const HAND_OFF_KEY = "pending_new_trip_hand_off";
const INTO_TRIP_KEY = "pending_into_trip";

/** Ten minutes, `pendingPlaybookAdd`'s budget: a create is seconds, a walk of the picker a few minutes. */
export const PENDING_CARRIED_ASKS_MAX_AGE_MS = 10 * 60 * 1000;

const CarriedAsk = z.object({ said: z.string().min(1).max(200), kind: z.string().min(1).max(40) });
/** An ask a surface could not do before the trip existed: what was said, and what it needs. */
export type CarriedAsk = z.infer<typeof CarriedAsk>;
const Asks = z.array(CarriedAsk).max(6);

/**
 * The picker's fields a hand-off may fill. `place` is a search, never a pick:
 * Where still takes only a result the person chooses (ADR-084 §7).
 */
const NewTripPrefill = z.object({
  place: z.string().min(1).max(200).optional(),
  days: z.number().int().min(1).max(60).optional(),
  tags: z.array(ActivityTagDescribed).max(12).optional(),
});
export type NewTripPrefill = z.infer<typeof NewTripPrefill>;

const HandOffRecord = z.object({ prefill: NewTripPrefill, asks: Asks, at: z.number() });
export type NewTripHandOff = Omit<z.infer<typeof HandOffRecord>, "at">;

const IntoTripRecord = z.object({ tripId: z.string(), kickoff: z.string().min(1).max(500).nullable(), asks: Asks, at: z.number() });
export type IntoTrip = Omit<z.infer<typeof IntoTripRecord>, "at" | "tripId">;

/** Every access is wrapped: Safari's private mode throws on `localStorage`. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function remember(key: string, record: object): void {
  try {
    storage()?.setItem(key, JSON.stringify(record));
  } catch {
    // Full quota, or storage refused: the trip is still made, without what rode along.
  }
}

/** Reads and clears `key`, and returns it only when it parses and is live. */
function take<T extends { at: number }>(key: string, schema: z.ZodType<T>, now: number): T | null {
  const store = storage();
  if (store === null) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(key);
    store.removeItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = schema.safeParse(parsed);
  if (!record.success) return null;
  const age = now - record.data.at;
  return age >= 0 && age <= PENDING_CARRIED_ASKS_MAX_AGE_MS ? record.data : null;
}

/** Bank a hand-off to New trip before opening it, or before going to Home to. */
export function rememberNewTripHandOff(handOff: NewTripHandOff, now: number = Date.now()): void {
  remember(HAND_OFF_KEY, { ...handOff, at: now });
}

/** The waiting hand-off, cleared, or `null`. */
export function takeNewTripHandOff(now: number = Date.now()): NewTripHandOff | null {
  const record = take(HAND_OFF_KEY, HandOffRecord, now);
  return record === null ? null : { prefill: record.prefill, asks: record.asks };
}

/** Bank what the new trip's board picks up, just before New trip goes to it. */
export function rememberIntoTrip(tripId: string, into: IntoTrip, now: number = Date.now()): void {
  remember(INTO_TRIP_KEY, { tripId, ...into, at: now });
}

/**
 * What New trip left for THIS trip, cleared, or `null`. Cleared on every path,
 * another trip's included: by then the person has gone somewhere else, and a
 * kickoff sent on a trip they opened later would be a turn nobody asked for.
 */
export function takeIntoTrip(tripId: string, now: number = Date.now()): IntoTrip | null {
  const record = take(INTO_TRIP_KEY, IntoTripRecord, now);
  return record === null || record.tripId !== tripId ? null : { kickoff: record.kickoff, asks: record.asks };
}
