import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PENDING_DEMO_CLONE_MAX_AGE_MS,
  forgetDemoClone,
  rememberDemoClone,
  takeDemoClone,
} from "./pendingDemoClone";

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
    expect(takeDemoClone()).toBe(false);
  });

  it("survives being written and is redeemed once", () => {
    rememberDemoClone();
    expect(takeDemoClone()).toBe(true);
    // Read-and-clear. Without this, landing on the trip list a second time
    // would take a second copy — and the redeeming effect is double-invoked
    // under StrictMode, so "once" has to be a property of this function.
    expect(takeDemoClone()).toBe(false);
  });

  it("expires rather than firing on an unrelated sign-in days later", () => {
    const now = 1_700_000_000_000;
    rememberDemoClone(now);
    expect(takeDemoClone(now + PENDING_DEMO_CLONE_MAX_AGE_MS + 1)).toBe(false);
  });

  it("is still live at the edge of its window", () => {
    const now = 1_700_000_000_000;
    rememberDemoClone(now);
    expect(takeDemoClone(now + PENDING_DEMO_CLONE_MAX_AGE_MS)).toBe(true);
  });

  it("clears an expired marker instead of leaving it to fire later", () => {
    const now = 1_700_000_000_000;
    rememberDemoClone(now);
    expect(takeDemoClone(now + PENDING_DEMO_CLONE_MAX_AGE_MS + 1)).toBe(false);
    // A stale marker that survived being read would keep being re-evaluated on
    // every later visit to the trip list.
    expect(takeDemoClone(now)).toBe(false);
  });

  it("can be withdrawn when the callbackUrl wins the race back", () => {
    rememberDemoClone();
    forgetDemoClone();
    expect(takeDemoClone()).toBe(false);
  });

  it("treats a corrupted value as nothing", () => {
    window.localStorage.setItem("pending_demo_clone", "yesterday");
    expect(takeDemoClone()).toBe(false);
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
    expect(() => rememberDemoClone()).not.toThrow();
    expect(() => forgetDemoClone()).not.toThrow();
    expect(takeDemoClone()).toBe(false);
  });
});
