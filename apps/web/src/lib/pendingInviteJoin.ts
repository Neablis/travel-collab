/**
 * "I pressed *Join* on an invite, and then I had to sign in."
 *
 * The invite landing's Join, pressed signed out, leaves for Google (or the
 * sign-in screen) and comes back to `/invite/<token>`. Without this, the person
 * arrives signed in on the same landing with the button still to press — the
 * round trip cost them their click, which is what `pendingDemoClone.ts` was
 * written to stop for the demo's *Make this trip mine* (Mitchell, 2026-08-28).
 *
 * **A browser marker, not `?join=1`.** A query flag on the callback URL is the
 * obvious carrier and the wrong one, for the reason the demo's `?clone=1` was
 * removed (Mitchell, 2026-09-01): a URL is shareable, so a link could make a
 * signed-in stranger join a trip they never chose. `localStorage` is
 * same-origin — nobody else's page can set it — and it names the token, so a
 * marker left by one invite cannot spend another.
 *
 * **Not a permission.** Redeeming it calls the ordinary accept endpoint, which
 * needs a session and a pending token; a forged marker can only do what the
 * person could have done by pressing the button on that very screen.
 */

const KEY = "pending_invite_join";

/**
 * Ten minutes, the budget `pending_admission` gets for the same round trip — a
 * marker that outlived it would turn an abandoned sign-in into a surprise join
 * the next time the link is opened.
 */
export const PENDING_INVITE_JOIN_MAX_AGE_MS = 10 * 60 * 1000;

/** Every access is wrapped: Safari's private mode throws on `localStorage`. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Bank "Join was pressed on this invite" before leaving for sign-in. */
export function rememberInviteJoin(token: string, now: number = Date.now()): void {
  try {
    storage()?.setItem(KEY, JSON.stringify({ token, at: now }));
  } catch {
    // A refused write loses the shortcut, not the join: the landing still
    // offers the button when they come back.
  }
}

/**
 * Reads the marker, clears it, and says whether it was a live one for `token`.
 *
 * Clears on every path, for the reason `takeDemoClone` does: a marker that
 * survived being read would fire again on every later visit, and the
 * read-and-clear is what makes a StrictMode double effect harmless.
 */
export function takeInviteJoin(token: string, now: number = Date.now()): boolean {
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
  try {
    const marker = JSON.parse(raw) as { token?: unknown; at?: unknown };
    if (marker.token !== token || typeof marker.at !== "number") return false;
    return now - marker.at >= 0 && now - marker.at <= PENDING_INVITE_JOIN_MAX_AGE_MS;
  } catch {
    return false;
  }
}

const JOINED_KEY = "invite_joined_toast";

/**
 * The toast the trip screen owes someone who just joined (SPEC §35.6: *You're
 * in — Dana can see you joined*), carried across the navigation into the trip.
 *
 * Session storage keyed by trip, not a query flag, for the same reason as the
 * marker above: `/trips/<id>?joined=Dana` is a link anyone could send, and it
 * would put words in a stranger's mouth on somebody else's screen.
 */
export function rememberJoinedToast(tripId: string, inviterName: string): void {
  try {
    window.sessionStorage.setItem(JOINED_KEY, JSON.stringify({ tripId, inviterName }));
  } catch {
    // No toast is the whole cost.
  }
}

/** The inviter's name if this trip has a join toast owed, else null. Read-and-clear. */
export function takeJoinedToast(tripId: string): string | null {
  try {
    const raw = window.sessionStorage.getItem(JOINED_KEY);
    if (raw === null) return null;
    const marker = JSON.parse(raw) as { tripId?: unknown; inviterName?: unknown };
    if (marker.tripId !== tripId || typeof marker.inviterName !== "string") return null;
    window.sessionStorage.removeItem(JOINED_KEY);
    return marker.inviterName;
  } catch {
    return null;
  }
}
