"use client";
import { createContext, useContext } from "react";
import type { TripSeed } from "@/lib/tripFirstData";

// Its own module rather than a field on `useTrip()`: the lens and the header
// that read it are tested without a `TripProvider`, and several suites mock
// that module whole.

/**
 * What the server sent with the trip page (`TripProvider`'s `initial`), while
 * it is still the trip on screen; `null` otherwise.
 */
export const TripSeedContext = createContext<TripSeed | null>(null);

/**
 * The seed, for a component that draws from the query cache: its first render
 * takes `peekCached(key) ?? seed`, so the server render, which has no cache,
 * and the hydrating render, which `TripProvider` has primed, draw the same
 * thing. `null` outside a seeded provider, and once the trip has moved on from
 * what the server sent.
 */
export function useTripSeed(): TripSeed | null {
  return useContext(TripSeedContext);
}
