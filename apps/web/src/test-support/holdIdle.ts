import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Holds every idle callback until `fire`, so a test decides when the page is
 * idle, and counts the ones still `waiting` (a cancelled one is not).
 *
 * `whenIdle` takes `requestIdleCallback` when the window has one. jsdom has
 * none, so without this it is a 200ms timer a test can only wait out. Undo
 * with `vi.unstubAllGlobals()`, after anything that could still cancel one
 * has unmounted.
 */
export function holdIdle(): { waiting: () => number; fire: () => void } {
  const waiting = new Map<number, () => void>();
  let next = 0;
  vi.stubGlobal("requestIdleCallback", (run: () => void) => {
    waiting.set(++next, run);
    return next;
  });
  vi.stubGlobal("cancelIdleCallback", (handle: number) => waiting.delete(handle));
  return {
    waiting: () => waiting.size,
    fire: () =>
      act(() => {
        const runs = [...waiting.values()];
        waiting.clear();
        runs.forEach((run) => run());
      }),
  };
}
