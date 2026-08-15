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
