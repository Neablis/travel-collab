import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

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

// jsdom ships no ResizeObserver (MapLens.tsx uses one to re-trigger maplibre's
// tile cover after the container's real size settles — see that file's own
// comment). No test needs it to actually fire a resize; it only needs to
// exist so `new ResizeObserver(...)` doesn't throw.
if (typeof window !== "undefined" && typeof window.ResizeObserver !== "function") {
  window.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom ships no IntersectionObserver (MapRail.tsx uses one, scoped to its own
// scrollable container, to track which day button is how visible as the rail
// scrolls). jsdom can't do real layout/visibility, so no test can make a real
// observer fire truthfully — instead, like setViewportMatches above, this is a
// real (if minimal) polyfill plus a small exported test-control surface:
// triggerIntersection lets a test hand-craft the entries a real browser would
// have produced and have them delivered to whichever observer(s) are
// currently watching those elements.
//
// boundingClientRect/rootBounds are optional and intentionally minimal (just
// enough to compute a center Y, not every real DOMRectReadOnly field) — a
// real IntersectionObserverEntry always carries both, but MapRail.tsx's
// center-distance selection only needs `top`/`bottom` out of each, and most
// existing tests only care about the ratio/isIntersecting minimum-visibility
// gate, not position, so those fields stay optional here.
type FakeRect = { top: number; bottom: number };
type FakeIntersectionEntry = {
  target: Element;
  isIntersecting: boolean;
  intersectionRatio: number;
  boundingClientRect?: FakeRect;
  rootBounds?: FakeRect | null;
};
type IntersectionCallback = (entries: FakeIntersectionEntry[]) => void;

const activeIntersectionObservers = new Set<{ callback: IntersectionCallback; elements: Set<Element> }>();

export function triggerIntersection(entries: FakeIntersectionEntry[]): void {
  for (const observer of activeIntersectionObservers) {
    const relevant = entries.filter((entry) => observer.elements.has(entry.target));
    if (relevant.length > 0) observer.callback(relevant);
  }
}

if (typeof window !== "undefined" && typeof window.IntersectionObserver !== "function") {
  class IntersectionObserverPolyfill {
    callback: IntersectionCallback;
    elements = new Set<Element>();

    constructor(callback: IntersectionCallback) {
      this.callback = callback;
      activeIntersectionObservers.add(this);
    }
    observe(el: Element): void {
      this.elements.add(el);
    }
    unobserve(el: Element): void {
      this.elements.delete(el);
    }
    disconnect(): void {
      activeIntersectionObservers.delete(this);
      this.elements.clear();
    }
    takeRecords(): FakeIntersectionEntry[] {
      return [];
    }
  }
  window.IntersectionObserver = IntersectionObserverPolyfill as unknown as typeof IntersectionObserver;
}
