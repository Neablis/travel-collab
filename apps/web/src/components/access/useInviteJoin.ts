"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { acceptInvite } from "@/lib/apiClient";
import { rememberInviteJoin, rememberJoinedToast } from "@/lib/pendingInviteJoin";

/**
 * *Join* on an invite — one path for the landing's button and the look
 * banner's (M27 D12: "the banner's action is Join the trip, which goes
 * through sign-in and back to the landing").
 *
 * **Signed out**, it banks the intent (`rememberInviteJoin`) and leaves for
 * sign-in with the landing as the way back; the landing redeems the marker and
 * finishes the join. **Signed in**, it accepts, carries the toast into the
 * trip, and goes there.
 *
 * A refused accept stays on the page with its message, and the token is left
 * exactly as it was — `acceptInvite` claims it only in the transaction that
 * grants the membership — so pressing Join again is a real retry (SPEC §35.10:
 * "Join failing (account created, membership not)").
 */
export function useInviteJoin({
  token,
  signedIn,
  inviterName,
  googleAvailable,
  onRefused,
}: {
  token: string;
  signedIn: boolean;
  inviterName: string;
  googleAvailable: boolean;
  /** Called after a refused accept, so the caller can re-read what the link now offers. */
  onRefused?: () => void;
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = useCallback(async () => {
    setJoining(true);
    setError(null);
    const landing = `/invite/${encodeURIComponent(token)}`;
    if (!signedIn) {
      rememberInviteJoin(token);
      // Re-banks the admission token before leaving. `proxy.ts` sets the
      // `pending_admission` cookie on every visit to this path, and that cookie
      // lives ten minutes — so somebody who read the landing for longer than
      // that would arrive at the gate with nothing, and a brand-new account
      // would be refused. One same-origin request refreshes it; failing it
      // costs nothing a returning account needs.
      await fetch(landing, { method: "HEAD", cache: "no-store" }).catch(() => undefined);
      if (googleAvailable) {
        void signIn("google", { callbackUrl: landing });
      } else {
        router.push(`/signin?callbackUrl=${encodeURIComponent(landing)}`);
      }
      return;
    }
    const result = await acceptInvite(token);
    if (!result.ok) {
      setJoining(false);
      setError(result.error.message);
      onRefused?.();
      return;
    }
    rememberJoinedToast(result.value.tripId, inviterName);
    // `joining` stays true: `router.push` does not unmount synchronously, and
    // a second press on this page would be a second accept.
    router.push(`/trips/${result.value.tripId}`);
  }, [token, signedIn, inviterName, googleAvailable, onRefused, router]);

  return { join, joining, error };
}
