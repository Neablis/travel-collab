"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { TripCover } from "@tc/contracts";
import { fetchTripCover } from "@/lib/apiClient";

// **The trip's cover, shared by the header's banner and Trip settings' picker**
// (Mitchell, 2026-10-10 preview: "I dont like that adding a cover photo makes
// no changes right away"). A cover is not on `TripDetail` — it is metadata in
// its own table (M37 D1), read from its own route — so `TripProvider`'s cache
// cannot carry it. This is the one place a page holds it: the header reads it
// once per trip, and the picker writes every pick or removal straight in, so
// the banner changes the moment the picker does, with no second read.
//
// Per trip id, for the life of the page. `undefined` is "not read yet" (and
// "the read failed" — the banner then shows nothing rather than an *Add cover*
// that might sit over a cover that exists); `null` is "no cover".

const covers = new Map<string, TripCover | null>();
const reading = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records `cover` as the trip's — a pick, a removal, or a read that landed. */
export function setCachedTripCover(tripId: string, cover: TripCover | null): void {
  covers.set(tripId, cover);
  emit();
}

/** Forgets every cover: for tests, which share the module across cases. */
export function resetTripCoverCache(): void {
  covers.clear();
  reading.clear();
  emit();
}

/**
 * The trip's cover: `undefined` until known, `null` for none. Reads it once
 * per trip id per page when `enabled`; `false` (the demo trip, whose visitor
 * has no session for the cover read) reads nothing and stays `undefined`.
 */
export function useTripCover(tripId: string, enabled: boolean): TripCover | null | undefined {
  const cover = useSyncExternalStore(
    subscribe,
    () => covers.get(tripId),
    () => undefined,
  );
  useEffect(() => {
    if (!enabled || covers.has(tripId) || reading.has(tripId)) return;
    reading.add(tripId);
    void fetchTripCover(tripId).then((result) => {
      reading.delete(tripId);
      // A pick that landed while this read was in flight is newer than it.
      if (result.ok && !covers.has(tripId)) setCachedTripCover(tripId, result.value);
    });
  }, [tripId, enabled]);
  return cover;
}
