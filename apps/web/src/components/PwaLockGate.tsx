"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import type { MfaStatusResponse } from "@/lib/mfaWire";
import { isStandalone } from "@/lib/installPrompt";
import {
  isPastIdle,
  lastActiveAt,
  lockSetting,
  onLockSettingChange,
  recordActivity,
  releaseEarlyLock,
  setLockSetting,
  unlockWithPasskey,
} from "@/lib/pwaLock";
import { signOutHere } from "@/lib/signOutHere";

// The installed app's idle lock (M62 D3b, `lib/pwaLock.ts`). The app stays
// mounted under the lock, only `inert`, so whatever was open is still there,
// half-typed, when the passkey clears it. Only in the installed app, and only for
// an account with a passkey (D16): an account without one is not locked, and the
// device's setting is left for whoever chose it.

// How often a foreground app looks at the clock, and how often a run of taps is
// written down: the shortest setting is 15 minutes, so neither needs to be finer.
const CHECK_EVERY_MS = 15_000;
const RECORD_EVERY_MS = 10_000;

async function accountHasPasskey(): Promise<boolean | null> {
  try {
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    const res = await fetch("/api/account/mfa/factors");
    if (!res.ok) return null;
    const status = (await res.json()) as MfaStatusResponse;
    return status.enabled && status.factors.some((factor) => factor.kind === "passkey");
  } catch {
    // Offline: the setting was turned on beside a passkey, so it stands.
    return null;
  }
}

/** Covers the app with a lock screen once the installed app has sat idle past this device's setting. */
export function PwaLockGate({
  signedIn,
  userId,
  children,
}: {
  signedIn: boolean;
  userId: string | null;
  children: React.ReactNode;
}) {
  const [watching, setWatching] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Bumped when the setting changes, here or in another window, so turning the
  // lock on in Account takes hold without a relaunch.
  const [settingChanges, setSettingChanges] = useState(0);
  const lastRecorded = useRef(0);
  const lockScreen = useRef<HTMLDivElement>(null);
  const unlockButton = useRef<HTMLButtonElement>(null);
  const focusBeforeLock = useRef<Element | null>(null);

  useEffect(() => onLockSettingChange(() => setSettingChanges((n) => n + 1)), []);

  // A layout effect, so a cold start past the idle time locks before the first
  // client frame rather than after it.
  // `EARLY_LOCK_SCRIPT` may have hidden the server's paint: shown again here when
  // there is no lock to put up, and by the lock's own effect when there is.
  useLayoutEffect(() => {
    if (!signedIn || !isStandalone(window) || lockSetting() === "off") {
      setWatching(false);
      releaseEarlyLock();
      return;
    }
    // Locked at once if it was closed past its time, before the check below
    // answers: the app must not show for the length of a request.
    const pastIdle = isPastIdle(lockSetting(), lastActiveAt(), Date.now());
    setLocked(pastIdle);
    if (!pastIdle) releaseEarlyLock();
    setWatching(true);
    let current = true;
    void accountHasPasskey().then((has) => {
      // The setting stays: it is the device's, and another account here may have chosen it.
      if (!current || has !== false) return;
      setWatching(false);
      setLocked(false);
    });
    return () => {
      current = false;
    };
  }, [signedIn, settingChanges]);

  useEffect(() => {
    if (!watching || locked) return;
    const lock = () => {
      // Read before the app goes inert, which drops focus to the body.
      focusBeforeLock.current = document.activeElement;
      setLocked(true);
    };
    const check = () => {
      if (isPastIdle(lockSetting(), lastActiveAt(), Date.now())) lock();
    };
    const activity = () => {
      const now = Date.now();
      if (now - lastRecorded.current < RECORD_EVERY_MS) return;
      // Looked at first: a tap that wakes an app already past its time is not activity that resets it.
      if (isPastIdle(lockSetting(), lastActiveAt(), now)) return lock();
      lastRecorded.current = now;
      recordActivity(now);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    window.addEventListener("pointerdown", activity, { capture: true });
    window.addEventListener("keydown", activity, { capture: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", activity, { capture: true });
      window.removeEventListener("keydown", activity, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watching, locked]);

  // Everything beside the lock goes inert, not only the app: a dialog or sheet
  // open when it locked is portalled to the body too. Its Radix layer has set
  // `pointer-events: none` on the body and traps focus, so the lock takes pointer
  // events back (`pointer-events-auto`) and keeps its own pointerdown and focusin from
  // the document, where that layer would close the dialog or pull focus back in.
  // Focus goes to Unlock, and back to whatever held it once opened (ADR-082).
  useLayoutEffect(() => {
    const overlay = lockScreen.current;
    if (!locked || overlay === null) return;
    const others = [...document.body.children].filter((el) => el !== overlay && !el.hasAttribute("inert"));
    for (const el of others) el.setAttribute("inert", "");
    const keep = (event: Event) => event.stopPropagation();
    overlay.addEventListener("pointerdown", keep);
    overlay.addEventListener("focusin", keep);
    // Escape is caught on the document in the capture phase, past `inert`: stopped
    // here on the window, before it, or the dialog underneath closes with what was typed in it.
    const keepEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.stopPropagation();
    };
    window.addEventListener("keydown", keepEscape, { capture: true });
    unlockButton.current?.focus();
    releaseEarlyLock();
    return () => {
      overlay.removeEventListener("pointerdown", keep);
      overlay.removeEventListener("focusin", keep);
      window.removeEventListener("keydown", keepEscape, { capture: true });
      for (const el of others) el.removeAttribute("inert");
      const before = focusBeforeLock.current;
      focusBeforeLock.current = null;
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, [locked]);

  async function unlock() {
    setUnlocking(true);
    setProblem(null);
    const result = await unlockWithPasskey();
    setUnlocking(false);
    if (result === "unlocked" || result === "unavailable") {
      // `unavailable` is the server saying the account has no passkey now: the lock is not for it.
      if (result === "unavailable") setLockSetting("off");
      else recordActivity();
      lastRecorded.current = Date.now();
      setLocked(false);
    } else if (result === "signed-out") {
      window.location.assign("/api/session-expired");
    } else if (result === "refused") {
      setProblem("That passkey could not unlock the app. Try again.");
    } else if (result === "offline") {
      setProblem("You're offline. Your passkey can open the app once you're connected.");
    }
  }

  return (
    <>
      {children}
      {locked
        ? createPortal(
            <div
              ref={lockScreen}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pwa-lock-title"
              className="overlay-layer pointer-events-auto fixed inset-0 flex flex-col items-center justify-center gap-4 bg-surface p-6 text-center"
            >
              <Heading level={2} id="pwa-lock-title">
                Caesura is locked
              </Heading>
              <Text variant="secondary" className="max-w-sm">
                Your passkey opens it again. This lock keeps the app private on this device; it does not sign you out,
                and it is not a substitute for locking your phone.
              </Text>
              {problem === null ? null : (
                <Text variant="secondary" role="alert" className="text-danger-ink">
                  {problem}
                </Text>
              )}
              <Button ref={unlockButton} variant="primary" pending={unlocking} onClick={() => void unlock()}>
                Unlock with passkey
              </Button>
              <Button variant="ghost" size="sm" onClick={() => signOutHere(userId)}>
                Sign out
              </Button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
