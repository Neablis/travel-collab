import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { clearQueryCache } from "./src/lib/queryCache";
// **No automated test may reach a third party** (Mitchell, 2026-09-24): the
// fetch guard, and Sentry's DSN forced empty. Shared with the integration lane
// so the two cannot drift — the why is in the file. A setup file runs before
// any test file's `server.listen()`, so MSW captures the guarded fetch as its
// passthrough: so a request with a handler is still answered by MSW and
// an unhandled one lands on the guard rather than on the network.
import "./src/test-support/networkGuard.setup";

// `src/server/config.ts` throws at import time if DATABASE_URL is unset (main's
// "fail loudly, no silent localhost fallback" change). Unit tests run in jsdom
// with no database and never open a connection, but a few of them import server
// modules that pull in that config (e.g. gateway.test.ts → gateway.ts →
// config.ts). Provide a dummy URL so the load-time guard passes; `??=` leaves a
// real DATABASE_URL (as int tests set) untouched.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test_unit";

// `src/server/api-tokens` refuses to mint or verify without a pepper, on purpose
// — an empty one would still produce a stable digest, so tokens would keep
// working while the property the key exists for silently did not hold. `||=`,
// not `??=`, so a blank `API_TOKEN_PEPPER=` in `.env.local` counts as missing —
// an empty string is not nullish (KI-2026-09-19-a). A real value is left alone;
// this one only has to be present and stable within a run, because nothing here
// asserts a digest against a fixture.
process.env.API_TOKEN_PEPPER ||= "test-pepper-not-a-real-key";

// **jsdom implements no scrolling, and one dependency calls it anyway.**
// `@atlaskit/pragmatic-drag-and-drop-auto-scroll`'s `try-scroll.js` calls
// `window.scrollBy` while a drag is near a viewport edge, and jsdom answers
// with `Error: Not implemented: Window's scrollBy() method` on its virtual
// console — 37 times in one unit run on 2026-09-23, all from
// `PageAssistant.test.tsx`, the suite that drags widgets.
//
// **A no-op is the honest stub here, and this is the argument for it rather
// than an apology.** Nothing in this repo asserts on scroll POSITION in jsdom,
// and nothing could: jsdom has no layout, so every element is 0x0 and every
// scroll offset is 0 whatever this function does. The auto-scroll behaviour
// that matters is a real-browser concern and is covered where a real browser
// is — `m13-day-sync.spec.ts` and `m10-map-rail.spec.ts` in the e2e lane.
// What the stub removes is a library's unmet expectation, not a signal.
//
// Assigned rather than spied, so it survives `vi.restoreAllMocks()`.
//
// **`??=` does not work here and the first version of this used it.** jsdom
// DEFINES `window.scrollBy`; the definition is a stub whose body raises the
// "Not implemented" error, so the property is never nullish and the default
// never fired. The log lines were unchanged and the setup looked correct —
// exactly the shape of silent no-op this repo keeps paying for. Overwrite it.
//
// **Guarded, because this setup file is shared with the `node` environment.**
// `vitest.unit.config.ts` runs `*.test.ts` under node and `*.test.tsx` under
// jsdom, and an unguarded `window` here is a `ReferenceError` at setup time
// that fails the whole FILE rather than any test in it — measured: 143 suites
// failed with 1649 tests still passing and none failing, which is what that
// looks like and reads like nothing at all.
if (typeof window !== "undefined") {
  window.scrollBy = () => {};
  window.scrollTo = () => {};
}

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
