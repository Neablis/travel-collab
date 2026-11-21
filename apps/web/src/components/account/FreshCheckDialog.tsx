"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { CodeEntryForm, type CodeKind } from "@/components/account/CodeEntryForm";
import { checkWithCode, checkWithPasskey } from "@/lib/mfaClient";

// The fresh check that adding a factor asks for (M62 D6): a second factor within
// the last ten minutes when two-step sign-in is on, and a fresh Google sign-in
// when it is off, since there is no second factor yet to ask for. It is the same
// verify step as sign-in, in a dialog: a passkey when the account has one, and an
// authenticator or recovery code either way.
//
// The off branch signs in with Google, which a preview or dev-login deployment
// does not have: there the button leads nowhere. Production is where an account
// reaches this branch.
/** Asks the person to prove it is them again before a change to how they sign in. */
export function FreshCheckDialog({
  mfaEnabled,
  hasPasskey,
  purpose = "Changing how you sign in",
  returnTo = "/account?tab=security",
  onChecked,
  onClose,
}: {
  mfaEnabled: boolean;
  /** What the check is for, as the start of a sentence: "<purpose> needs a passkey first." */
  purpose?: string;
  /** The page a sign-in this dialog sends the person through comes back to: the one the check was asked from. */
  returnTo?: string;
  /** Whether the account holds a passkey; without one, the dialog opens on the code field. */
  hasPasskey: boolean;
  onChecked: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [code, setCode] = useState<CodeKind | null>(hasPasskey ? null : "otp");
  const [codeProblem, setCodeProblem] = useState<string | null>(null);
  // Close works while the browser's prompt is up, so an answer that arrives after
  // it must not go on to add a passkey the person walked away from.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  // Choosing a method unmounts the button that had focus, which would drop it to the
  // page's start. A code field takes focus itself (`autoFocus`); the passkey view's
  // own button is handed it here.
  const passkeyButton = useRef<HTMLButtonElement>(null);
  const switched = useRef(false);
  useEffect(() => {
    if (switched.current && code === null) passkeyButton.current?.focus();
  }, [code]);

  async function check() {
    setBusy(true);
    setRefused(false);
    const result = await checkWithPasskey();
    if (!open.current) return;
    setBusy(false);
    if (result === "passed") onChecked();
    else if (result !== "cancelled") setRefused(true);
  }

  function choose(next: CodeKind | null) {
    setCodeProblem(null);
    setRefused(false);
    switched.current = true;
    setCode(next);
  }

  async function checkCode(kind: CodeKind, typed: string) {
    setBusy(true);
    setCodeProblem(null);
    const result = await checkWithCode(kind, typed);
    if (!open.current) return;
    setBusy(false);
    if (result === "passed") onChecked();
    else if (result === "signed-out") window.location.assign(`/api/session-expired?callbackUrl=${encodeURIComponent(returnTo)}`);
    else if (result === "not-required") onClose();
    else
      setCodeProblem(
        result === "locked" ? "Too many wrong codes. Try again in 15 minutes." : "That code did not work. Try again.",
      );
  }

  if (!mfaEnabled) {
    return (
      <Dialog
        open
        onOpenChange={(open) => (open ? undefined : onClose())}
        title="Sign in again"
        description="Adding a second step needs a fresh sign-in. Sign in with Google again and you will come back here."
      >
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void signIn("google", { callbackUrl: returnTo })}>
            Sign in with Google
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Confirm it’s you"
      description={`${purpose} needs ${code === null ? "your passkey" : "a code"} first. It stays good for ten minutes.`}
    >
      <div className="flex flex-col gap-3">
        {code === null ? null : (
          <CodeEntryForm
            key={code}
            kind={code}
            pending={busy}
            problem={codeProblem}
            onSubmit={(typed) => void checkCode(code, typed)}
          />
        )}
        {refused && code === null ? (
          <Text variant="secondary" role="alert" className="text-danger-ink">
            That passkey did not work. Try again.
          </Text>
        ) : null}
        <div className="flex flex-col items-start gap-1">
          {hasPasskey && code !== null ? (
            <Button variant="ghost" size="sm" onClick={() => choose(null)}>
              Use a passkey
            </Button>
          ) : null}
          {code !== "otp" ? (
            <Button variant="ghost" size="sm" onClick={() => choose("otp")}>
              Use authenticator code
            </Button>
          ) : null}
          {code !== "recovery" ? (
            <Button variant="ghost" size="sm" onClick={() => choose("recovery")}>
              Use a recovery code
            </Button>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {code === null ? (
          <Button ref={passkeyButton} variant="primary" pending={busy} onClick={() => void check()}>
            Use a passkey
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}
