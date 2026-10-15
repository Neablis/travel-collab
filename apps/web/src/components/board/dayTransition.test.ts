import { describe, expect, it } from "vitest";
import { DAY_CHANGE_TRANSITION_MS, dayChangeTransition } from "./dayTransition";

const opts = { oneDay: true, dayCount: 5, reducedMotion: false };

describe("dayChangeTransition", () => {
  it.each([
    // [name, prev, next, opts overrides, expected]
    ["a later day slides forward", 1, 2, {}, { from: 1, to: 2 }],
    ["an earlier day slides backward", 2, 1, {}, { from: 2, to: 1 }],
    ["a jump of several days still slides once", 0, 4, {}, { from: 0, to: 4 }],
    ["no previous day never animates (mount)", null, 0, {}, null],
    ["deselecting never animates", 2, null, {}, null],
    ["a no-op change never animates", 2, 2, {}, null],
    ["a ghost suggestion day never animates", 4, 5, {}, null],
    ["a removed day never animates", 4, 3, { dayCount: 3 }, null],
    ["a negative index never animates", -1, 0, {}, null],
    ["an empty trip never animates", 0, 0, { dayCount: 0 }, null],
    ["the desktop row never animates", 1, 2, { oneDay: false }, null],
    ["reduced motion never animates", 1, 2, { reducedMotion: true }, null],
  ] as const)("%s", (_name, prev, next, overrides, expected) => {
    expect(dayChangeTransition(prev, next, { ...opts, ...overrides })).toEqual(expected);
  });

  it("is quick enough to repeat without annoyance", () => {
    expect(DAY_CHANGE_TRANSITION_MS).toBeLessThanOrEqual(200);
  });
});
