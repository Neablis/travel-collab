import { describe, expect, it } from "vitest";
import {
  DAY_SWIPE_DIRECTION_RATIO,
  DAY_SWIPE_MAX_DURATION_MS,
  DAY_SWIPE_MIN_DISTANCE_PX,
  classifyDaySwipe,
  type SwipePoint,
} from "./daySwipe";

const at = (x: number, y: number, t: number): SwipePoint => ({ x, y, t });

describe("classifyDaySwipe", () => {
  it.each([
    // [name, start, end, expected]
    ["a quick leftward swipe steps to the next day", at(200, 400, 0), at(100, 405, 150), 1],
    ["a quick rightward swipe steps to the previous day", at(100, 400, 0), at(200, 395, 150), -1],
    ["exactly the minimum distance still counts", at(100, 400, 0), at(100 - DAY_SWIPE_MIN_DISTANCE_PX, 400, 150), 1],
    ["a vertical swipe is a scroll, not a day change", at(200, 400, 0), at(205, 600, 150), 0],
    ["a slow swipe may be a hold-drag, never a day change", at(200, 400, 0), at(50, 400, DAY_SWIPE_MAX_DURATION_MS), 0],
    ["a short swipe is a tap's jitter, not a day change", at(200, 400, 0), at(200 - (DAY_SWIPE_MIN_DISTANCE_PX - 1), 400, 150), 0],
    [
      // |dx| = 100 must stay within RATIO * |dy| for this to read as diagonal.
      "a diagonal stays the browser's",
      at(200, 400, 0),
      at(100, 400 + 100 / DAY_SWIPE_DIRECTION_RATIO + 10, 150),
      0,
    ],
    ["a backwards clock is a broken reading, not a fast finger", at(200, 400, 150), at(100, 400, 0), 0],
    ["no movement is not a swipe", at(200, 400, 0), at(200, 400, 150), 0],
    // |dx| == 2*|dy| is exactly the cone's edge: strictly greater is required.
    ["exactly twice the vertical travel is still not horizontal enough", at(200, 400, 0), at(100, 450, 150), 0],
  ] as const)("%s", (_name, start, end, expected) => {
    expect(classifyDaySwipe(start, end)).toBe(expected);
  });
});
