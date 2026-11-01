import { z } from "zod";
import { CarriedAsks, NewTripPrefill, type CarriedAsk } from "@tc/contracts";
import { ASK_THREAD_PREFIX } from "./askOwnership";

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

// `turnId` (M57) is the assistant turn that handed off: it rides every hop so
// the trip made from it, and each chip pressed there, can name the turn.
const TurnId = z.string().guid().optional();
const HandOffRecord = z.object({ prefill: NewTripPrefill, asks: CarriedAsks, turnId: TurnId, at: z.number() });
export type NewTripHandOff = Omit<z.infer<typeof HandOffRecord>, "at">;

const IntoTripRecord = z.object({ tripId: z.string(), kickoff: z.string().min(1).max(500).nullable(), asks: CarriedAsks, turnId: TurnId, at: z.number() });
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
  return record === null ? null : { prefill: record.prefill, asks: record.asks, ...(record.turnId === undefined ? {} : { turnId: record.turnId }) };
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
  return record === null || record.tripId !== tripId
    ? null
    : { kickoff: record.kickoff, asks: record.asks, ...(record.turnId === undefined ? {} : { turnId: record.turnId }) };
}

/**
 * **The chips a new trip's rail still offers, kept beside its thread.** The
 * kickoff is the thread's first turn and survives a reload there, so the asks
 * that rode in with it must too, until each is pressed. Under the thread's own
 * prefix and owned name (`thread`, `useOwnedAskName`'s), so sign-out's
 * `forgetAskConversationsOf` forgets them with it.
 */
function carriedKey(thread: string): string {
  return `${ASK_THREAD_PREFIX}:${thread}:carried`;
}

/** The asks still offered on conversation `thread`; none when nothing parses. Never throws. */
export function loadCarriedAsks(thread: string): CarriedAsk[] {
  try {
    const raw = storage()?.getItem(carriedKey(thread)) ?? null;
    if (raw === null) return [];
    const asks = CarriedAsks.safeParse(JSON.parse(raw));
    return asks.success ? asks.data : [];
  } catch {
    return [];
  }
}

/** Keeps `asks` as conversation `thread`'s chips; none left removes the key. Never throws. */
export function saveCarriedAsks(thread: string, asks: readonly CarriedAsk[]): void {
  try {
    if (asks.length === 0) storage()?.removeItem(carriedKey(thread));
    else storage()?.setItem(carriedKey(thread), JSON.stringify(asks));
  } catch {
    // See `remember`: the chips are still on screen, only not past a reload.
  }
}

/**
 * The turn the chips on conversation `thread` came from (M57), kept beside
 * them for the same reload; `undefined` when none, or on a trip that predates it.
 */
export function loadCarriedTurn(thread: string): string | undefined {
  try {
    const raw = storage()?.getItem(`${carriedKey(thread)}:turn`) ?? null;
    return raw === null ? undefined : z.string().guid().safeParse(raw).data;
  } catch {
    return undefined;
  }
}

/** Keeps `turnId` as the source of conversation `thread`'s chips; none removes it. Never throws. */
export function saveCarriedTurn(thread: string, turnId: string | undefined): void {
  try {
    if (turnId === undefined) storage()?.removeItem(`${carriedKey(thread)}:turn`);
    else storage()?.setItem(`${carriedKey(thread)}:turn`, turnId);
  } catch {
    // See `remember`.
  }
}
