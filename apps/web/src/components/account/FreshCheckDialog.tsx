"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { CodeEntryForm, type CodeKind } from "@/components/front/CodeEntryForm";
import { checkWithCode, checkWithPasskey } from "@/lib/mfaClient";

// The fresh check that adding a factor asks for (M62 D6): a second factor within
// the last ten minutes when two-step sign-in is on, and a fresh Google sign-in
// when it is off, since there is no second factor yet to ask for. It is the same
// verify step as sign-in, in a dialog: a passkey when the account has one, and an
// authenticator or recovery code either way.
/** Asks the person to prove it is them again before a change to how they sign in. */
export function FreshCheckDialog({
  mfaEnabled,
  hasPasskey,
  onChecked,
  onClose,
}: {
  mfaEnabled: boolean;
  /** Whether the account holds a passkey; without one, the dialog opens on the code field. */
  hasPasskey: boolean;
  onChecked: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const [code, setCode] = useState<CodeKind | null>(hasPasskey ? null : "otp");
  const [codeProblem, setCodeProblem] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setRefused(false);
    const result = await checkWithPasskey();
    setBusy(false);
    if (result === "passed") onChecked();
    else if (result !== "cancelled") setRefused(true);
  }

  function choose(next: CodeKind | null) {
    setCodeProblem(null);
    setRefused(false);
    setCode(next);
  }

  async function checkCode(kind: CodeKind, typed: string) {
    setBusy(true);
    setCodeProblem(null);
    const result = await checkWithCode(kind, typed);
    setBusy(false);
    if (result === "passed") onChecked();
    else setCodeProblem(result === "locked" ? "Too many wrong codes. Try again in 15 minutes." : "That code did not work. Try again.");
  }

  if (!mfaEnabled) {
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())} title="Sign in again">
        <Text variant="secondary">
          Adding a second step needs a fresh sign-in. Sign in with Google again and you will come back here.
        </Text>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void signIn("google", { callbackUrl: "/account?tab=security" })}>
            Sign in with Google
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())} title="Confirm it’s you">
      <div className="flex flex-col gap-3">
        <Text variant="secondary">
          Changing how you sign in needs {code === null ? "your passkey" : "a code"} first. It stays good for ten minutes.
        </Text>
        {code === null ? null : <CodeEntryForm key={code} kind={code} pending={busy} onSubmit={(typed) => void checkCode(code, typed)} />}
        {refused && code === null ? (
          <Text variant="secondary" role="alert" className="text-danger-ink">
            That passkey did not work. Try again.
          </Text>
        ) : null}
        {codeProblem !== null && code !== null ? (
          <Text variant="secondary" role="alert" className="text-danger-ink">
            {codeProblem}
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
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {code === null ? (
          <Button variant="primary" pending={busy} onClick={() => void check()}>
            Use a passkey
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}
