import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_DEMO_CLONE_MAX_AGE_MS,
  rememberDemoClone,
  takeDemoClone,
} from "./pendingDemoClone";
import { DEMO_TRIP_ID, DEMO_TRIPS } from "./demoTrip";

// The marker that carries "Make this trip mine" across a detour the demo page
// cannot see the far end of (Mitchell, 2026-09-01). Every one of these is a
// path he actually walked and arrived from with no trip.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the pending demo-clone marker", () => {
  it("is not set until somebody asks for a copy", () => {
    expect(takeDemoClone()).toBeNull();
  });

  it("survives being written and is redeemed once", () => {
    rememberDemoClone(DEMO_TRIP_ID);
    expect(takeDemoClone()).toBe(DEMO_TRIP_ID);
    // Read-and-clear. Without this, landing on the trip list a second time
    // would take a second copy — and the redeeming effect is double-invoked
    // under StrictMode, so "once" has to be a property of this function.
    expect(takeDemoClone()).toBeNull();
  });

  it("is still live at the edge of its window", () => {
    const now = 1_700_000_000_000;
    rememberDemoClone(DEMO_TRIP_ID, now);
    expect(takeDemoClone(now + PENDING_DEMO_CLONE_MAX_AGE_MS)).toBe(DEMO_TRIP_ID);
  });

  it("expires a moment later, and clears itself rather than firing another day", () => {
    const now = 1_700_000_000_000;
    rememberDemoClone(DEMO_TRIP_ID, now);
    // One millisecond past the window: an unrelated sign-in days later must not
    // redeem a copy nobody asked for today.
    expect(takeDemoClone(now + PENDING_DEMO_CLONE_MAX_AGE_MS + 1)).toBeNull();
    // A stale marker that survived being read would keep being re-evaluated on
    // every later visit to the trip list.
    expect(takeDemoClone(now)).toBeNull();
  });

  // M42 D1: five demos, and the trip list that redeems the marker has no page
  // of its own to say which was pressed. A marker that forgot would hand
  // somebody who asked for Iceland a copy of Japan.
  it("names the demo that was pressed, and only ever a demo", () => {
    const iceland = DEMO_TRIPS.find((demo) => demo.slug === "iceland-ring-road")!.tripId;
    rememberDemoClone(iceland);
    expect(takeDemoClone()).toBe(iceland);
    rememberDemoClone("6f1c2b8e-0d1a-4c55-9e1f-2b6c1d1e9a77");
    expect(takeDemoClone()).toBeNull();
  });

  it("treats a corrupted value as nothing", () => {
    window.localStorage.setItem("pending_demo_clone", "yesterday");
    expect(takeDemoClone()).toBeNull();
  });

  it("degrades to no shortcut when storage throws", () => {
    // Safari's private mode throws on `localStorage` access. The button still
    // works for anyone who signs in and presses it again; what must not happen
    // is the navigation to sign-in failing.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => rememberDemoClone(DEMO_TRIP_ID)).not.toThrow();
    expect(takeDemoClone()).toBeNull();
  });
});
