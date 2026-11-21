"use client";

import { useEffect, useState } from "react";
import type { MfaStatusResponse } from "@/lib/mfaWire";
import { FreshCheckDialog } from "./FreshCheckDialog";

// The check a server asked for with a 403 `fresh-check-required` (M62 D8) from a
// screen that does not hold the account's factors: Create token and the consent
// page. The refusal itself says two-step sign-in is on, so the only thing left to
// learn is whether the dialog should open on a passkey or on a code field.
/** Opens the fresh check once it knows whether the account has a passkey; `onChecked` is the cue to retry. */
export function FreshCheckOnDemand({
  purpose,
  returnTo,
  onChecked,
  onClose,
}: {
  purpose: string;
  /** Where sign-in comes back to if the check finds the session signed out (`FreshCheckDialog`). */
  returnTo?: string;
  onChecked: () => void;
  onClose: () => void;
}) {
  // `null` until the read lands; a failed read opens on the code field, which every account can use.
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    // eslint-disable-next-line no-restricted-globals -- an app API call with no client helper yet; moves onto the client with the collapse still open in KI-2026-09-05-q
    fetch("/api/account/mfa/factors")
      .then((res) => (res.ok ? (res.json() as Promise<MfaStatusResponse>) : null))
      .then((status) => live && setHasPasskey(status?.factors.some((f) => f.kind === "passkey") ?? false))
      .catch(() => live && setHasPasskey(false));
    return () => {
      live = false;
    };
  }, []);
  if (hasPasskey === null) return null;
  return (
    <FreshCheckDialog
      mfaEnabled
      hasPasskey={hasPasskey}
      purpose={purpose}
      returnTo={returnTo}
      onChecked={onChecked}
      onClose={onClose}
    />
  );
}
