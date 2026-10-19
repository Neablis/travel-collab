/**
 * "I pressed *Add to a trip* on a playbook, and then I had to make an account."
 *
 * The same detour `pendingDemoClone.ts` was written for — sign-in, the swap to
 * sign-up, Google, a refusal screen — and the same answer: the intent is banked
 * in the browser rather than threaded through every one of those URLs (that
 * file records the three hops that drop a `?callbackUrl=`). ADR-061.
 *
 * **What redeeming it does depends on the way in** (M50 decision 5, as
 * Mitchell narrowed it on 2026-10-19). Through sign-up (`"new-trip"`): a new
 * account has no trip to choose, so the press is the choice, and the day page
 * makes a trip named for the day and goes to it. Through sign-in
 * (`"choose-trip"`): an existing account may well have the trip this day
 * belongs in, so the day page opens the add dialog instead. A forged marker —
 * `localStorage` is same-origin, so forging it already means running script on
 * this origin — can do no more than give the reader a trip of their own holding
 * a public day they could have added themselves.
 *
 * **Keyed to one day.** The marker carries the `savedDayId` it was banked on,
 * and only that day's page redeems it. Without that, a reader who pressed Add on
 * one day, signed in, and then opened a different link would get a trip made
 * from a day they never asked to add.
 */

const KEY = "pending_playbook_add";

/**
 * Ten minutes, `pendingDemoClone`'s budget for the same round trip: long enough
 * for Google plus a fumbled invite code, short enough that an abandoned signup
 * does not make a trip on an unrelated visit to the same day tomorrow.
 */
export const PENDING_PLAYBOOK_ADD_MAX_AGE_MS = 10 * 60 * 1000;

/** Every access is wrapped: Safari's private mode throws on `localStorage`. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * What the return does: make a trip (`"new-trip"`), or ask which one
 * (`"choose-trip"`). A marker naming anything else is never redeemed.
 */
export type PlaybookAddIntent = "new-trip" | "choose-trip";

/** Bank the add before sending a signed-out reader to sign in or sign up. */
export function rememberPlaybookAdd(
  savedDayId: string,
  intent: PlaybookAddIntent = "new-trip",
  now: number = Date.now(),
): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ savedDayId, intent, at: now }));
  } catch {
    // Full quota, or a browser refusing storage. The reader can press Add again
    // once signed in; losing the shortcut is not worth failing the navigation.
  }
}

/**
 * Reads the marker, clears it, and names its intent if it was live and for
 * THIS day — `null` otherwise.
 *
 * **Clears on every path** — expired, unreadable, or banked on another day.
 * A marker for another day that survived being read here would still be live
 * when its own day is opened later in the window, which sounds like a feature
 * and is not: by then the reader has been somewhere else, and a trip appearing
 * from a page they navigated to on their own is a surprise, not a resumption.
 * Read-and-clear is also what makes it single-use: the redeeming page's
 * StrictMode double-effect, or a remount, finds nothing and makes no second
 * trip or second dialog.
 */
export function takePlaybookAdd(savedDayId: string, now: number = Date.now()): PlaybookAddIntent | null {
  const store = storage();
  if (store === null) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
    store.removeItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let marker: unknown;
  try {
    marker = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof marker !== "object" || marker === null) return null;
  const { savedDayId: banked, intent, at } = marker as { savedDayId?: unknown; intent?: unknown; at?: unknown };
  if (banked !== savedDayId || (intent !== "new-trip" && intent !== "choose-trip")) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return now - at >= 0 && now - at <= PENDING_PLAYBOOK_ADD_MAX_AGE_MS ? intent : null;
}

/**
 * Which day a live marker is waiting on, WITHOUT clearing it — or `null`.
 *
 * For the trip list (`(app)/home/page.tsx`), which is where a new account often
 * lands: a refused sign-up is redirected server-side and loses its
 * `callbackUrl` (`pendingDemoClone.ts` lists the hops). The list sends the
 * reader back to the day, and the day page's `takePlaybookAdd` is what spends
 * the marker and makes the trip. Left in place here so that one place spends
 * it, and so a list that never navigates leaves nothing half-done.
 *
 * Only an id-shaped value comes back, since it becomes a path.
 */
export function pendingPlaybookAddDay(now: number = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  let marker: unknown;
  try {
    marker = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof marker !== "object" || marker === null) return null;
  const { savedDayId, at } = marker as { savedDayId?: unknown; at?: unknown };
  if (typeof savedDayId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(savedDayId)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return now - at >= 0 && now - at <= PENDING_PLAYBOOK_ADD_MAX_AGE_MS ? savedDayId : null;
}
