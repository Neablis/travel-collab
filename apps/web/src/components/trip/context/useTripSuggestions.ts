"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResolveSuggestionChangeInput, SuggestionChange } from "@tc/contracts";
import { fetchTripSuggestions, resolveSuggestionChange, type ApiResult } from "@/lib/apiClient";

/** The trip's suggestion changes as the context exposes them (spec §2.4). */
export type TripSuggestions = {
  /** Every change this reader may see, in creation order — pending or not. */
  changes: SuggestionChange[];
  /** The list's revision, as the events poll reports it; null before the first read. */
  rev: string | null;
  /** True while a read is in flight. */
  loading: boolean;
  /** Why the last read failed; the last good list is kept. */
  error: string | null;
  /** Read the list again now. */
  refresh: () => Promise<void>;
  /**
   * Accept, dismiss or withdraw one change, then re-read the list — on a
   * refusal too, which usually means the list was stale. An accept also
   * refetches the trip, so the change shows as confirmed.
   */
  resolve: (changeId: string, action: ResolveSuggestionChangeInput["action"]) => Promise<ApiResult<SuggestionChange[]>>;
};

type Args = {
  tripId: string;
  /** False for a reader who may not see suggestions (`boardMode === "read"`): nothing is read. */
  enabled: boolean;
  /** The trip moved because a change was accepted; the provider's remote-change refetch. */
  onAccepted: () => void;
};

/**
 * The suggestion list for `TripProvider`: read on mount, and again whenever
 * the poll's revision differs from the one held (W6, W16), or on request.
 * `suggestions` is null while disabled. `onRevision` is for the poll's
 * `onSuggestionsChanged`.
 */
export function useTripSuggestions({ tripId, enabled, onAccepted }: Args): {
  suggestions: TripSuggestions | null;
  onRevision: (rev: string) => void;
} {
  const [changes, setChanges] = useState<SuggestionChange[]>([]);
  const [rev, setRev] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Read by `onRevision`, which the poll holds in a ref and calls between
  // renders: it must compare against the newest list, not a render-old one.
  const revRef = useRef<string | null>(null);
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;
  // Only the newest read may land. A poll's refetch and a resolve's can cross,
  // and an older answer arriving last would put a resolved change back.
  const latest = useRef(0);
  const live = useRef(enabled);
  live.current = enabled;

  const refresh = useCallback(async () => {
    if (!live.current) return;
    const ticket = ++latest.current;
    setInFlight((n) => n + 1);
    const result = await fetchTripSuggestions(tripId);
    setInFlight((n) => n - 1);
    if (ticket !== latest.current || !live.current) return;
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    revRef.current = result.value.rev;
    setRev(result.value.rev);
    setChanges(result.value.changes);
    setError(null);
  }, [tripId]);

  useEffect(() => {
    if (enabled) {
      void refresh();
      return;
    }
    // Disabled, or the trip changed under a disabled hook: nothing held over.
    latest.current++;
    revRef.current = null;
    setRev(null);
    setChanges([]);
    setError(null);
  }, [enabled, refresh]);

  const onRevision = useCallback(
    (next: string) => {
      // The poll reports the first revision it sees, which is usually the one
      // the mount read already holds.
      if (next !== revRef.current) void refresh();
    },
    [refresh],
  );

  const resolve = useCallback(
    async (changeId: string, action: ResolveSuggestionChangeInput["action"]) => {
      const result = await resolveSuggestionChange(tripId, changeId, action);
      if (result.ok && action === "accept") onAcceptedRef.current();
      await refresh();
      return result;
    },
    [tripId, refresh],
  );

  const loading = inFlight > 0;
  const suggestions = useMemo<TripSuggestions | null>(
    () => (enabled ? { changes, rev, loading, error, refresh, resolve } : null),
    [enabled, changes, rev, loading, error, refresh, resolve],
  );
  return { suggestions, onRevision };
}
