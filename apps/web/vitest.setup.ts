import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { clearQueryCache } from "./src/lib/queryCache";

// `src/server/config.ts` throws at import time if DATABASE_URL is unset (main's
// "fail loudly, no silent localhost fallback" change). Unit tests run in jsdom
// with no database and never open a connection, but a few of them import server
// modules that pull in that config (e.g. gateway.test.ts → gateway.ts →
// config.ts). Provide a dummy URL so the load-time guard passes; `??=` leaves a
// real DATABASE_URL (as int tests set) untouched.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test_unit";

// @testing-library/react's automatic cleanup-after-each only self-registers
// when it detects `globals: true`-style test framework globals. This repo's
// vitest config does not set `test.globals`, so without this, DOM/body state
// from one test (e.g. a Radix Dialog's `pointer-events: none` body lock)
// leaks into the next test in the same file. Register cleanup explicitly.
afterEach(() => {
  cleanup();
  // The API read cache (ADR-046) is a module-level Map, so it outlives an
  // `it()` the way MSW's handlers do — and a cache is the worst possible thing
  // to leak between tests, because it does not fail, it PASSES with the
  // previous test's answer. Found the moment it landed: four TripProvider
  // tests that mock a failing read went green against the success a test above
  // them had cached ("expected 'ready' to be 'error'"). Reset it here rather
  // than per file, for the reason cleanup() is here — the file that forgets is
  // the one that debugs this for an afternoon.
  clearQueryCache();
  // **`localStorage` is module-level state by another name**, and it leaks the
  // same way — silently, and by PASSING with the previous test's value rather
  // than failing. M9's conversation durability is what found it: the board's
  // suite mounts the same trip in test after test, so the second test onward
  // restored the first one's thread and nine assertions about an empty
  // transcript went red at once.
  //
  // Cleared here for the reason `cleanup()` and `clearQueryCache()` are: the
  // file that forgets is the one that spends an afternoon on it. Guarded on
  // `window`, because the node project has no storage — and wrapped, because a
  // test that stubs `localStorage` with something incomplete must not turn
  // teardown into the failure.
  try {
    if (typeof window !== "undefined") window.localStorage?.clear?.();
  } catch {
    // A stubbed or refused storage. Nothing to clear, nothing to report.
  }
});

// jsdom ships no matchMedia. Components that adapt to a breakpoint (the
// assistant rail's 1180px overlay threshold) call it on mount, so without this
// every test rendering them throws. Default: no query matches — i.e. tests run
// at the "narrow" end unless a test overrides it via setViewportMatches below.
const mediaMatches = new Map<string, boolean>();

export function setViewportMatches(matches: Record<string, boolean>): void {
  mediaMatches.clear();
  for (const [query, value] of Object.entries(matches)) mediaMatches.set(query, value);
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: mediaMatches.get(query) ?? false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom ships no ResizeObserver. Two components need one: MapLens.tsx (to
// re-trigger maplibre's tile cover once the container's real size settles) and
// MapRail.tsx (to re-measure its day buttons' offsets when layout changes).
//
// MapLens only needs the constructor not to throw. MapRail needs a test to be
// able to say "layout changed, measure again" — so this is a real, if minimal,
// polyfill plus a small test-control surface, the same shape as
// setViewportMatches above.
//
// Note what triggerResize deliberately is NOT: it does not hand the component
// any geometry. It only prompts a re-measure, exactly as a real ResizeObserver
// does; the component then reads the (test-installed, static) layout itself.
// The IntersectionObserver fixture this replaces did the opposite — it fed
// fabricated per-scroll positions that no real browser ever delivers, which is
// why the suite passed while the feature was broken. Do not reintroduce that.
const activeResizeObservers = new Set<{ callback: () => void; elements: Set<Element> }>();

export function triggerResize(): void {
  for (const observer of activeResizeObservers) {
    if (observer.elements.size > 0) observer.callback();
  }
}

if (typeof window !== "undefined" && typeof window.ResizeObserver !== "function") {
  class ResizeObserverPolyfill {
    callback: () => void;
    elements = new Set<Element>();

    constructor(callback: () => void) {
      this.callback = callback;
      activeResizeObservers.add(this);
    }
    observe(el: Element): void {
      this.elements.add(el);
    }
    unobserve(el: Element): void {
      this.elements.delete(el);
    }
    disconnect(): void {
      activeResizeObservers.delete(this);
      this.elements.clear();
    }
  }
  window.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}
