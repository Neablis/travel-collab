"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import type { MfaStatusResponse } from "@/lib/mfaWire";
import { isPastIdle, isStandalone, lastActiveAt, lockSetting, recordActivity, setLockSetting, unlockWithPasskey } from "@/lib/pwaLock";
import { clearSignedInHint } from "@/lib/sessionHint";

// The installed app's idle lock (M62 D3b, `lib/pwaLock.ts`). The app stays
// mounted under the lock, only `inert`, so whatever was open is still there,
// half-typed, when the passkey clears it. Only in the installed app, and only for
// an account with a passkey (D16): an account that has lost its last one has the
// setting cleared rather than a lock it cannot open.

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
export function PwaLockGate({ signedIn, children }: { signedIn: boolean; children: React.ReactNode }) {
  const [watching, setWatching] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lastRecorded = useRef(0);

  useEffect(() => {
    if (!signedIn || !isStandalone(window) || lockSetting() === "off") return;
    // Locked at once if it was closed past its time, before the check below
    // answers: the app must not show for the length of a request.
    setLocked(isPastIdle(lockSetting(), lastActiveAt(), Date.now()));
    setWatching(true);
    let current = true;
    void accountHasPasskey().then((has) => {
      if (!current || has !== false) return;
      setLockSetting("off");
      setWatching(false);
      setLocked(false);
    });
    return () => {
      current = false;
    };
  }, [signedIn]);

  useEffect(() => {
    if (!watching || locked) return;
    const check = () => {
      if (isPastIdle(lockSetting(), lastActiveAt(), Date.now())) setLocked(true);
    };
    const activity = () => {
      const now = Date.now();
      if (now - lastRecorded.current < RECORD_EVERY_MS) return;
      // Looked at first: a tap that wakes an app already past its time is not activity that resets it.
      if (isPastIdle(lockSetting(), lastActiveAt(), now)) return setLocked(true);
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
    }
  }

  return (
    <>
      <div className="contents" inert={locked}>
        {children}
      </div>
      {locked
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pwa-lock-title"
              className="overlay-layer fixed inset-0 flex flex-col items-center justify-center gap-4 bg-surface p-6 text-center"
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
              <Button variant="primary" pending={unlocking} onClick={() => void unlock()}>
                Unlock with passkey
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearSignedInHint();
                  void signOut({ callbackUrl: "/" });
                }}
              >
                Sign out
              </Button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
