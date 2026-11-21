"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { checkWithPasskey } from "@/lib/mfaClient";

// The fresh check that adding a factor asks for (M62 D6): a second factor within
// the last ten minutes when two-step sign-in is on, and a fresh Google sign-in
// when it is off, since there is no second factor yet to ask for. It is the same
// verify step as sign-in, in a dialog. Codes join the passkey in part 3.
//
// The off branch signs in with Google, which a preview or dev-login deployment
// does not have: there the button leads nowhere. Production is where an account
// reaches this branch.
/** Asks the person to prove it is them again before a change to how they sign in. */
export function FreshCheckDialog({
  mfaEnabled,
  onChecked,
  onClose,
}: {
  mfaEnabled: boolean;
  onChecked: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  // Close works while the browser's prompt is up, so an answer that arrives after
  // it must not go on to add a passkey the person walked away from.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  async function check() {
    setBusy(true);
    setRefused(false);
    const result = await checkWithPasskey();
    if (!open.current) return;
    setBusy(false);
    if (result === "passed") onChecked();
    else if (result !== "cancelled") setRefused(true);
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
          <Button variant="primary" onClick={() => void signIn("google", { callbackUrl: "/account?tab=security" })}>
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
      description="Changing how you sign in needs your passkey first. It stays good for ten minutes."
    >
      {refused ? (
        <Text variant="secondary" role="alert" className="mt-2 text-danger-ink">
          That passkey did not work. Try again.
        </Text>
      ) : null}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" pending={busy} onClick={() => void check()}>
          Use a passkey
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
