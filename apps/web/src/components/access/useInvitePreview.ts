"use client";

import { useCallback, useEffect, useState } from "react";
import type { TripPreview } from "@tc/contracts";
import { fetchInvitePreview } from "@/lib/apiClient";

export type PreviewRead = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; preview: TripPreview };

/**
 * `GET /api/invites/:token/preview`, read only once the landing says the invite
 * is `pending` — the preview refuses (404/410) every other invite, and the
 * landing is what says why.
 *
 * Its own read, with its own retry, because the preview is the trip's picture
 * and not the invite: a failed one costs the card, never the Join beside it.
 */
export function useInvitePreview(token: string, pending: boolean): { read: PreviewRead; retry: () => void } {
  const [read, setRead] = useState<PreviewRead>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    void fetchInvitePreview(token).then((result) => {
      if (live) setRead(result.ok ? { kind: "ready", preview: result.value } : { kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [token, pending, attempt]);

  const retry = useCallback(() => {
    setRead({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { read, retry };
}
