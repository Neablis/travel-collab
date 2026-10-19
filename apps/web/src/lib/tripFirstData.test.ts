import { afterEach, describe, expect, it, vi } from "vitest";
import { tripFirstDataFixture } from "@/test-support/tripFirstData";
import { peekCached, subscribeQueryCache } from "@/lib/queryCache";
import { coverKeys, tripKeys } from "@/lib/queryKeys";
import { primeTripSeed, seedFrom } from "./tripFirstData";

// The query cache is a module, so on the server one instance serves every
// request: a prime there would hand one reader's trip to whoever next asked
// for the same key. `primeTripSeed` refuses without a window, whatever its
// caller checked. This file runs in node, so each test says which side it is.
describe("primeTripSeed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stores nothing on the server", () => {
    const seed = seedFrom(tripFirstDataFixture());
    vi.stubGlobal("window", undefined);
    primeTripSeed(seed.detail.tripId, seed);
    vi.unstubAllGlobals();
    expect(peekCached(tripKeys.detail(seed.detail.tripId))).toBeUndefined();
    expect(peekCached(coverKeys.trip(seed.detail.tripId))).toBeUndefined();
  });

  it("stores every read the board makes, in a browser", () => {
    const seed = seedFrom(tripFirstDataFixture());
    const tripId = seed.detail.tripId;
    vi.stubGlobal("window", {});
    primeTripSeed(tripId, seed);
    expect(peekCached(tripKeys.detail(tripId))).toBe(seed.detail);
    expect(peekCached(tripKeys.history(tripId))).toBe(seed.history);
    expect(peekCached(tripKeys.access(tripId))).toBe(seed.access);
    expect(peekCached(coverKeys.trip(tripId))).toBe(seed.cover);
    expect(peekCached(tripKeys.pages(tripId))).toBe(seed.pages);
    expect(peekCached(tripKeys.page(tripId, seed.overview!.id))).toBe(seed.overview);
    expect(peekCached(tripKeys.globals(tripId))).toBe(seed.globals);
  });

  // It runs during `TripProvider`'s render. A subscriber told then (the
  // loading skeleton's cover peek) would be updated while another component
  // renders, which React reports and refuses to batch.
  it("tells no subscriber, since it runs during a render", () => {
    const seed = seedFrom(tripFirstDataFixture());
    const heard = vi.fn();
    const unsubscribe = subscribeQueryCache(heard);
    vi.stubGlobal("window", {});
    primeTripSeed(seed.detail.tripId, seed);
    unsubscribe();
    expect(peekCached(tripKeys.detail(seed.detail.tripId))).toBe(seed.detail);
    expect(heard).not.toHaveBeenCalled();
  });
});
