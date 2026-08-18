import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAP_RAIL_TUNING_DEFAULTS,
  onMapRailTuningChange,
  readMapRailTuning,
  setMapRailTuning,
} from "./mapRailTuning";

afterEach(() => {
  setMapRailTuning(null);
});

describe("mapRailTuning", () => {
  it("reads the defaults when nothing is overridden", () => {
    expect(readMapRailTuning()).toEqual(MAP_RAIL_TUNING_DEFAULTS);
  });

  it("merges a partial override over the defaults", () => {
    setMapRailTuning({ scrollPxPerDay: 320 });

    expect(readMapRailTuning().scrollPxPerDay).toBe(320);
    expect(readMapRailTuning().scrollThrottleMs).toBe(MAP_RAIL_TUNING_DEFAULTS.scrollThrottleMs);
  });

  it("resets to the defaults when passed null", () => {
    setMapRailTuning({ scrollPxPerDay: 320 });
    setMapRailTuning(null);

    expect(readMapRailTuning()).toEqual(MAP_RAIL_TUNING_DEFAULTS);
  });

  it("notifies subscribers on change, and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onMapRailTuningChange(listener);

    setMapRailTuning({ scrollPxPerDay: 320 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setMapRailTuning({ scrollPxPerDay: 400 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("defaults the focus line to a full sweep, which is what reaches every day", () => {
    expect(MAP_RAIL_TUNING_DEFAULTS.focusLineStart).toBe(0);
    expect(MAP_RAIL_TUNING_DEFAULTS.focusLineEnd).toBe(1);
  });
});
