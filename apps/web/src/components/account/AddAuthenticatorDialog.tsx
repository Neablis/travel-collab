"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { CodeEntryForm } from "@/components/front/CodeEntryForm";
import { confirmAuthenticator, startAuthenticator, type AuthenticatorStart } from "@/lib/mfaClient";

// Adding an authenticator app (M62 D2): scan the QR code, or type the secret from
// *Can't scan?*, then type the six digits the app shows. Nothing is saved until
// that code is right, so closing this leaves the account as it was.
/** The QR code, the secret as text, and the field that confirms the app has it. */
export function AddAuthenticatorDialog({
  onAdded,
  onFreshCheckRequired,
  onClose,
}: {
  /** `recoveryCodes` is set only when this was the first factor and so turned two-step sign-in on; `signedIn` is false when the session could not be told. */
  onAdded: (recoveryCodes: string[] | null, signedIn: boolean) => void;
  /** The route wants a fresh second-factor check, before it hands out a secret or when the code is confirmed. */
  onFreshCheckRequired: () => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState<AuthenticatorStart | "failed" | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let live = true;
    void startAuthenticator().then((result) => {
      if (!live) return;
      if (result.status === "started") setStart(result.start);
      else if (result.status === "fresh-check-required") onFreshCheckRequired();
      else setStart("failed");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open; the callback is only ever the parent's setter
  }, []);

  async function confirm(code: string) {
    if (start === null || start === "failed") return;
    setChecking(true);
    setProblem(null);
    const result = await confirmAuthenticator(start.ticket, code);
    setChecking(false);
    if (result.status === "added") onAdded(result.recoveryCodes, result.signedIn);
    else if (result.status === "fresh-check-required") onFreshCheckRequired();
    else if (result.status === "wrong-code") setProblem("That code did not work. Check your app and try again.");
    else if (result.status === "locked") setProblem("Too many wrong codes. Try again in 15 minutes.");
    else setProblem("The authenticator app could not be added just now. Try again.");
  }

  return (
    <Dialog open onOpenChange={(open) => (open || checking ? undefined : onClose())} title="Add an authenticator app">
      <div className="flex flex-col gap-4">
        {start === "failed" ? (
          <Text variant="secondary" role="alert" className="text-danger-ink">
            An authenticator app could not be set up just now. Try again in a moment.
          </Text>
        ) : start === null ? (
          <Text variant="secondary">Getting a code ready…</Text>
        ) : (
          <>
            <Text variant="secondary">
              Scan this with an authenticator app, such as 1Password, Google Authenticator or Authy, then type the 6-digit
              code it shows.
            </Text>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL drawn by the server; next/image has nothing to optimise */}
            <img src={start.qr} alt="QR code for your authenticator app" width={240} height={240} className="self-center rounded-md bg-surface" />
            <div className="flex flex-col gap-1">
              <Button variant="ghost" size="sm" className="self-start" aria-expanded={showSecret} onClick={() => setShowSecret((v) => !v)}>
                Can&rsquo;t scan?
              </Button>
              {showSecret ? (
                <Text variant="secondary">
                  Enter this key in your app: <code className="font-mono text-ink">{start.secret}</code>
                </Text>
              ) : null}
            </div>
            <CodeEntryForm kind="otp" pending={checking} problem={problem} onSubmit={(code) => void confirm(code)} />
          </>
        )}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={checking} onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
