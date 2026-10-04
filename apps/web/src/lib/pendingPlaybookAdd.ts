/**
 * "I pressed *Add to a trip* on a playbook, and then I had to make an account."
 *
 * The same detour `pendingDemoClone.ts` was written for — sign-in, the swap to
 * sign-up, Google, a refusal screen — and the same answer: the intent is banked
 * in the browser rather than threaded through every one of those URLs (that
 * file records the three hops that drop a `?callbackUrl=`). ADR-061.
 *
 * **What redeeming it does is smaller than the demo's**, and on purpose. The
 * demo's marker makes the copy; this one only OPENS the add dialog on the day
 * it names. Which trip the day goes into is still the reader's own click, so a
 * forged marker — and `localStorage` is same-origin, so forging it already
 * means running script on this origin — can do no more than open a dialog.
 *
 * **Keyed to one day.** The marker carries the `savedDayId` it was banked on,
 * and only that day's page redeems it. Without that, a reader who pressed Add on
 * one day, signed in, and then opened a different link would have the dialog
 * open over a day they never asked to add.
 */

const KEY = "pending_playbook_add";

/**
 * Ten minutes, `pendingDemoClone`'s budget for the same round trip: long enough
 * for Google plus a fumbled invite code, short enough that an abandoned signup
 * does not pop a dialog on an unrelated visit to the same day tomorrow.
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

/** Bank "add this day" before sending a signed-out reader to sign in. */
export function rememberPlaybookAdd(savedDayId: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ savedDayId, at: now }));
  } catch {
    // Full quota, or a browser refusing storage. The reader can press Add again
    // once signed in; losing the shortcut is not worth failing the navigation.
  }
}

/**
 * Reads the marker, clears it, and says whether it was live and for THIS day.
 *
 * **Clears on every path** — expired, unreadable, or banked on another day.
 * A marker for another day that survived being read here would still be live
 * when its own day is opened later in the window, which sounds like a feature
 * and is not: by then the reader has been somewhere else, and a dialog opening
 * over a page they navigated to on their own is a surprise, not a resumption.
 * Read-and-clear is also what makes the redeeming page's StrictMode
 * double-effect safe: the second pass finds nothing.
 */
export function takePlaybookAdd(savedDayId: string, now: number = Date.now()): boolean {
  const store = storage();
  if (store === null) return false;
  let raw: string | null = null;
  try {
    raw = store.getItem(KEY);
    store.removeItem(KEY);
  } catch {
    return false;
  }
  if (raw === null) return false;
  let marker: unknown;
  try {
    marker = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof marker !== "object" || marker === null) return false;
  const { savedDayId: banked, at } = marker as { savedDayId?: unknown; at?: unknown };
  if (banked !== savedDayId || typeof at !== "number" || !Number.isFinite(at)) return false;
  return now - at >= 0 && now - at <= PENDING_PLAYBOOK_ADD_MAX_AGE_MS;
}

/**
 * Which day a live marker is waiting on, WITHOUT clearing it — or `null`.
 *
 * For the trip list (`(app)/page.tsx`), which is where a new account often
 * lands: a refused sign-up is redirected server-side and loses its
 * `callbackUrl` (`pendingDemoClone.ts` lists the hops). The list sends the
 * reader back to the day, and the day page's `takePlaybookAdd` is what spends
 * the marker and opens the dialog. Left in place here so that one place spends
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
