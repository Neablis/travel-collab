/**
 * "I pressed *Make this trip mine*, and then I had to make an account."
 *
 * The intent has to survive a detour the demo page cannot see the far end of:
 * `/demo` → `/signin` → *Create an account* → `/signup` → Google → possibly a
 * refusal screen (`/signup?error=…`) → Google again → wherever Auth.js decides
 * to land them. Mitchell walked exactly that on 2026-09-01 and arrived with no
 * trip: *"after you sign up (whether or not you errored because you didnt have
 * code, or you did have code, or if you already had account) you dont have the
 * trip from the demo you tried to clone"*.
 *
 * The `?callbackUrl=` the demo attaches carried it only as far as `/signin`.
 * Three separate things drop it:
 *
 *   1. The sign-in ⇄ sign-up swap link is a bare `/signup` (fixed alongside
 *      this, so the query survives that hop too).
 *   2. `refusalRedirect` sends a refused sign-in to `/signup?error=<reason>` —
 *      a path built server-side, inside the Auth.js callback, with no access
 *      to where the browser was originally headed.
 *   3. A returning account never sees `/demo` at all — the gate waves them
 *      through and Auth.js lands them wherever the callback said, which after
 *      hop 1 or 2 is `/`.
 *
 * So the intent is banked in the browser instead of being threaded through
 * every one of those URLs, and it is redeemed on arrival at the trip list —
 * the one page every successful sign-in reaches. `localStorage`, not a cookie:
 * nothing on the server reads it, it must not ride on requests, and it has to
 * outlive a full-page navigation to Google and back (which `sessionStorage`
 * does, but a new tab would not).
 *
 * **Not a permission.** Redeeming it calls the ordinary duplicate endpoint,
 * which answers 401 to anyone without a session and refuses a trip they cannot
 * read. The worst a forged marker does is copy the public demo trip — which is
 * the button's whole purpose.
 */

const KEY = "pending_demo_clone";

/**
 * Ten minutes, the same budget `pending_admission` gets, and for the same
 * reason: long enough for a Google round trip plus a fumbled invite code,
 * short enough that a marker left behind by an abandoned signup does not make
 * a surprise trip appear on an unrelated sign-in a day later.
 */
export const PENDING_DEMO_CLONE_MAX_AGE_MS = 10 * 60 * 1000;

/** Every access is wrapped: Safari's private mode throws on `localStorage`. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function rememberDemoClone(now: number = Date.now()): void {
  try {
    storage()?.setItem(KEY, String(now));
  } catch {
    // Full quota, or a browser refusing storage. The button still works for
    // anyone who signs in and presses it again; losing the shortcut is not
    // worth failing the navigation to sign-in over.
  }
}

export function forgetDemoClone(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to do, and nothing that depends on it: `takeDemoClone` clears
    // before it reports, so a failed clear at worst re-offers once.
  }
}

/**
 * Reads the marker, clears it, and says whether it was live.
 *
 * **Clears on every path, including the expired one** — a stale marker that
 * survived being read would keep firing on every later visit to the trip list.
 * Reading and clearing in one call is also what makes the redeeming page's
 * StrictMode double-effect safe: the second pass finds nothing.
 */
export function takeDemoClone(now: number = Date.now()): boolean {
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
  const at = Number(raw);
  if (!Number.isFinite(at)) return false;
  return now - at >= 0 && now - at <= PENDING_DEMO_CLONE_MAX_AGE_MS;
}
