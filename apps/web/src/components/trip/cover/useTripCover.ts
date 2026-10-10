"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { TripCover } from "@tc/contracts";
import { fetchTripCover } from "@/lib/apiClient";
import { cachedRead, DEDUPE, peekCached, subscribeQueryCache } from "@/lib/queryCache";
import { coverKeys } from "@/lib/queryKeys";

// **The trip's cover, as the header's banner reads it** (Mitchell, 2026-10-10
// preview: "I dont like that adding a cover photo makes no changes right
// away"). A cover is not on `TripDetail` — it is metadata in its own table
// (M37 D1), read from its own route — so `TripProvider` cannot carry it.
//
// **One source of truth: the query cache under `coverKeys.trip`** (PR #384
// review). This was a store of its own beside the cache Trip settings' picker
// (`CoverSection`) reads, and the two only met on the picker's own writes: a
// co-editor's new cover, read by Settings, never reached the banner, and the
// banner's read never warmed Settings' first open. Now both read the same key
// through `cachedRead`, the picker's writes `primeCached` it, and the banner
// paints whatever is stored there and re-renders when anyone stores a newer
// answer (`subscribeQueryCache`) — so a pick still shows on the trip at once,
// and a read from either side updates both.
//
// `vitest.setup.ts` clears the cache after every test, so nothing here
// outlives a test case either.

/** Reads the trip's cover through the same cache entry Trip settings' picker reads. */
export function readTripCover(tripId: string) {
  return cachedRead(coverKeys.trip(tripId), () => fetchTripCover(tripId), { dedupeMs: DEDUPE.DOCUMENT });
}

/**
 * The trip's cover as last stored: `undefined` until known (or when `enabled`
 * is false), `null` for none. Reads nothing — for a placeholder that should
 * agree with the banner without starting a read of its own.
 */
export function usePeekedTripCover(tripId: string, enabled: boolean): TripCover | null | undefined {
  return useSyncExternalStore(
    subscribeQueryCache,
    () => (enabled ? peekCached<TripCover | null>(coverKeys.trip(tripId)) : undefined),
    () => undefined,
  );
}

/**
 * The trip's cover: `undefined` until known, `null` for none. Reads it through
 * the cache when `enabled`; `false` (the demo trip, whose visitor has no
 * session for the cover read) reads nothing and stays `undefined`. A failed
 * read also stays `undefined`, and the banner then shows nothing rather than
 * an *Add cover* that might sit over a cover that exists.
 */
export function useTripCover(tripId: string, enabled: boolean): TripCover | null | undefined {
  const cover = usePeekedTripCover(tripId, enabled);
  useEffect(() => {
    if (!enabled) return;
    void readTripCover(tripId);
  }, [tripId, enabled]);
  return cover;
}
