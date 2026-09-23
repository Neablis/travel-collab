"use client";

import { useEffect, useState } from "react";
import { Toast } from "@/components/ui/toast";
import { takeJoinedToast } from "@/lib/pendingInviteJoin";

/**
 * *You're in — Dana can see you joined* (SPEC §35.6), shown once on the trip a
 * person has just joined from its invite.
 *
 * Its own island on the trip page rather than a branch inside the board: the
 * board has no idea how you arrived, and should not have to. The message was
 * left in session storage by `useInviteJoin` just before it navigated here —
 * read and cleared on mount, so a reload does not repeat it.
 */
export function JoinedToast({ tripId }: { tripId: string }) {
  const [inviter, setInviter] = useState<string | null>(null);
  useEffect(() => {
    setInviter(takeJoinedToast(tripId));
  }, [tripId]);
  if (inviter === null) return null;
  return <Toast message={`You're in — ${inviter} can see you joined`} onDismiss={() => setInviter(null)} />;
}
