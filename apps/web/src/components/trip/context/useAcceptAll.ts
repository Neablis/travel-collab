"use client";

import { useState } from "react";
import type { SuggestionChange } from "@tc/contracts";
import { useOptionalTrip } from "./TripProvider";
import { acceptAllOrder } from "@/lib/acceptAll";

/** *Accept all*, as the suggestions chip and the chat's suggested note both offer it. */
export type AcceptAll = {
  /** Every pending change that still applies, parents first — what one click accepts. */
  acceptable: SuggestionChange[];
  accepting: boolean;
  /** The server's sentence when it refused; it names the change and says nothing landed. */
  refusal: string | null;
  /** True when everything landed, false when it was refused. */
  acceptAll: () => Promise<boolean>;
  clearRefusal: () => void;
};

/**
 * *Accept all* for the trip on screen (W77, as M40 D1 amends it): every change
 * that still applies, in ONE call, so one History entry and one undo, all or
 * nothing. The header's chip and the chat's note (Mitchell's preview comment,
 * 2026-10-10) call this one hook, so the two buttons cannot drift apart.
 *
 * Null outside a trip, for a reader who cannot accept (`boardMode` other than
 * `write`), and while suggestions are not loaded.
 */
export function useAcceptAll(): AcceptAll | null {
  const trip = useOptionalTrip();
  const [accepting, setAccepting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const ghosts = trip?.suggestionGhosts ?? null;
  const suggestions = trip?.suggestions ?? null;
  if (trip === null || trip.boardMode !== "write" || ghosts === null || suggestions === null) return null;

  const acceptable = acceptAllOrder(ghosts.pending, new Set(ghosts.stale.map((g) => g.changeId)));
  const acceptAll = async () => {
    setRefusal(null);
    setAccepting(true);
    const result = await suggestions.acceptMany(acceptable.map((c) => c.id));
    setAccepting(false);
    if (!result.ok) setRefusal(result.error.message);
    return result.ok;
  };
  return { acceptable, accepting, refusal, acceptAll, clearRefusal: () => setRefusal(null) };
}
