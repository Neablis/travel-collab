import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react's automatic cleanup-after-each only self-registers
// when it detects `globals: true`-style test framework globals. This repo's
// vitest config does not set `test.globals`, so without this, DOM/body state
// from one test (e.g. a Radix Dialog's `pointer-events: none` body lock)
// leaks into the next test in the same file. Register cleanup explicitly.
afterEach(() => {
  cleanup();
});
