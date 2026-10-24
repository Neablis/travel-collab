import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMinuteClock } from "./useMinuteClock";

// The reader's clock for Home's hero, a notebook page and its day-of widgets:
// a countdown or *now and next* left open must move on with the time, and a
// tab brought back after a while must not show the time it was hidden at.

const MINUTE = 60_000;
const T = Date.parse("2026-06-10T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(T);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useMinuteClock", () => {
  it("reads the time again each minute, with the device's zone", () => {
    const { result } = renderHook(() => useMinuteClock());
    expect(result.current).toEqual({ at: T, deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    act(() => {
      vi.advanceTimersByTime(MINUTE);
    });
    expect(result.current?.at).toBe(T + MINUTE);
  });

  it("reads it again when the tab comes back into view", () => {
    const { result } = renderHook(() => useMinuteClock());
    // A hidden tab's interval can be throttled, so the time moves without it.
    vi.setSystemTime(T + 30 * MINUTE + 1);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current?.at).toBe(T + 30 * MINUTE + 1);
  });
});
