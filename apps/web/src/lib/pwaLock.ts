import { startAuthentication } from "@simplewebauthn/browser";

// The installed app's lock (M62 D3b, D16): after a chosen idle time, the app is
// covered until a passkey says the person is back. It is a client gate over a
// session that stays valid, so drafts and the offline cache survive it, and it
// is convenience on a shared device, not a security boundary (ADR-092 §8).
//
// The setting is per device, in this browser's storage, because a phone and a
// laptop want different answers. Every access is wrapped: Safari's private mode
// and a blocked-storage setting throw on `localStorage` itself. A failure reads
// as "off": a lock that cannot remember it was turned on stays out of the way.

/** How long the installed app may sit idle before it locks. */
export type LockAfter = "off" | "15m" | "1h" | "1d";

export const LOCK_AFTER_MS: Record<Exclude<LockAfter, "off">, number> = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

const LOCK_AFTER = "caesura_lock_after";
const LOCK_SETTING_CHANGED = "caesura:lock-setting";
const LAST_ACTIVE = "caesura_last_active";

type StorageAccess = () => Storage;
const local: StorageAccess = () => window.localStorage;

const isLockAfter = (value: string | null): value is Exclude<LockAfter, "off"> =>
  value !== null && Object.hasOwn(LOCK_AFTER_MS, value);

/** This device's lock setting; `off` when unset, garbled or unreadable. */
export function lockSetting(storage: StorageAccess = local): LockAfter {
  try {
    const value = storage().getItem(LOCK_AFTER);
    return isLockAfter(value) ? value : "off";
  } catch {
    return "off";
  }
}

/**
 * Stores the setting, and starts the idle clock from `now` so turning it on does
 * not lock at once over an old timestamp. `false` when storage refused it.
 */
export function setLockSetting(value: LockAfter, now: number = Date.now(), storage: StorageAccess = local): boolean {
  try {
    if (value === "off") storage().removeItem(LOCK_AFTER);
    else {
      storage().setItem(LOCK_AFTER, value);
      storage().setItem(LAST_ACTIVE, String(now));
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event(LOCK_SETTING_CHANGED));
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls `listener` whenever the setting changes, in this window or another, so a
 * lock already mounted starts or stops watching without a relaunch. Returns the
 * unsubscribe.
 */
export function onLockSettingChange(listener: () => void): () => void {
  const fromStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === LOCK_AFTER) listener();
  };
  window.addEventListener(LOCK_SETTING_CHANGED, listener);
  window.addEventListener("storage", fromStorage);
  return () => {
    window.removeEventListener(LOCK_SETTING_CHANGED, listener);
    window.removeEventListener("storage", fromStorage);
  };
}

/** When this device last saw the person use the app, or `null` if never or unreadable. */
export function lastActiveAt(storage: StorageAccess = local): number | null {
  try {
    const at = Number(storage().getItem(LAST_ACTIVE));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Notes activity now. Kept in storage, not memory, so a closed app reopened after the idle time locks too. */
export function recordActivity(now: number = Date.now(), storage: StorageAccess = local): void {
  try {
    storage().setItem(LAST_ACTIVE, String(now));
  } catch {
    // Refused: `lockSetting` reads off on the same storage, so nothing locks.
  }
}

/**
 * Drops the record of activity, on sign out. The setting is the device's, but the
 * last activity was this person's: left behind, it would lock the next account to
 * sign in at once, over an idle time that was never its own.
 */
export function forgetActivity(storage: StorageAccess = local): void {
  try {
    storage().removeItem(LAST_ACTIVE);
  } catch {
    // Unreadable storage holds no record to forget.
  }
}

// The attribute `globals.css` hides the app under, and how long it may stay.
const EARLY_LOCK_MARK = "data-pwa-locked";
const EARLY_LOCK_FAILSAFE_MS = 10_000;

/**
 * Hides the page before it paints when an installed app is reopened past its idle
 * time. Inlined ahead of the app's server HTML, which would otherwise show for as
 * long as hydration takes, until `PwaLockGate`'s layout effect covers it; the gate
 * shows the page again (`releaseEarlyLock`) once its lock is up, or once it has
 * decided not to lock. The same test as `isStandalone` and `isPastIdle`, which
 * cannot run before the bundle; the keys and durations are this module's.
 *
 * It marks `<html>` and `globals.css` does the hiding, of everything but the M54
 * launch splash, which is still the first frame of a home-screen launch. A bundle
 * that never hydrates would leave the gate unmounted and the page blank for good,
 * Sign out included, so the mark lifts itself after `EARLY_LOCK_FAILSAFE_MS`: long
 * enough for a slow phone to hydrate first, as the splash's own fail-safe is.
 */
export const EARLY_LOCK_SCRIPT =
  `try{var m=${JSON.stringify(LOCK_AFTER_MS)},k=localStorage.getItem(${JSON.stringify(LOCK_AFTER)}),` +
  `a=Number(localStorage.getItem(${JSON.stringify(LAST_ACTIVE)})),h=document.documentElement;` +
  `if((navigator.standalone===true||(typeof matchMedia==="function"&&matchMedia("(display-mode: standalone)").matches))` +
  `&&Object.prototype.hasOwnProperty.call(m,k)&&a>0&&Date.now()-a>=m[k]){h.setAttribute(${JSON.stringify(EARLY_LOCK_MARK)},"");` +
  `setTimeout(function(){h.removeAttribute(${JSON.stringify(EARLY_LOCK_MARK)})},${EARLY_LOCK_FAILSAFE_MS})}}catch(e){}`;

/** Undoes `EARLY_LOCK_SCRIPT`; a no-op when it hid nothing. */
export function releaseEarlyLock(): void {
  document.documentElement.removeAttribute(EARLY_LOCK_MARK);
}

/**
 * Whether the app has been idle past its setting. Never with the lock off, nor
 * with no record of activity, nor with a last activity in the future (a clock set
 * back): each would lock someone who had not walked away.
 */
export function isPastIdle(setting: LockAfter, lastActive: number | null, now: number): boolean {
  if (setting === "off" || lastActive === null) return false;
  return now - lastActive >= LOCK_AFTER_MS[setting];
}

/**
 * `unavailable`: the account has no passkey (or no second step) any more, so
 * there is nothing the lock can ask for. `signed-out`: no session behind the cookie.
 * `offline`: the request never reached the server, so no passkey was judged.
 */
export type UnlockResult = "unlocked" | "cancelled" | "refused" | "unavailable" | "signed-out" | "offline";

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
  const res = await fetch("/api/mfa/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

/**
 * Asks for a passkey with the verify route's `unlock` purpose, which answers
 * without a proof: unlocking leaves the session as it was, where
 * `mfaClient.checkWithPasskey` would restart its second-factor clock. Never throws.
 */
export async function unlockWithPasskey(): Promise<UnlockResult> {
  try {
    const asked = await post({ kind: "passkey", step: "options" });
    if (asked.status === 401) return "signed-out";
    if (asked.status === 409) return "unavailable";
    if (asked.status !== 200 || asked.body === null) return "refused";
    let response;
    try {
      response = await startAuthentication({ optionsJSON: asked.body.options as never });
    } catch (error) {
      const closed = error instanceof Error && (error.name === "NotAllowedError" || error.name === "AbortError");
      return closed ? "cancelled" : "refused";
    }
    const verified = await post({ kind: "passkey", step: "verify", purpose: "unlock", ticket: asked.body.ticket, response });
    if (verified.status === 401 && verified.body?.error === "unauthenticated") return "signed-out";
    return verified.status === 200 && verified.body?.unlocked === true ? "unlocked" : "refused";
  } catch {
    // Only `fetch` can throw here: the prompt's own errors are caught above.
    return "offline";
  }
}
