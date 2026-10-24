import { afterEach, describe, expect, it } from "vitest";
import { clockIn } from "@tc/pages";
import { pinClock, type EvalClock } from "./evalClock";
import { evalInstant } from "./trips";

const RealDate = Date;
// `performance` is not faked by any clock here, so it is the real one to measure against.
const realMs = () => performance.now();
const spin = (ms: number) => {
  const until = realMs() + ms;
  while (realMs() < until);
};

let clock: EvalClock | undefined;
afterEach(() => clock?.restore());

describe("the live set's clock", () => {
  // A turn's latency, step durations and step deadline are all read off `Date`
  // (handleAskRequest.ts). A faked clock that ticks in 20 ms steps from a
  // timer fell behind under load (PR 545 review, finding 1), so the eval read
  // every turn as faster than it was and let a step run past its deadline.
  it("advances at real speed, across a busy stretch and a real await", async () => {
    clock = pinClock();
    clock.startTurnAt(evalInstant(RealDate.now()));
    const fakedFrom = Date.now();
    const realFrom = realMs();
    spin(150);
    await new Promise((resolve) => setTimeout(resolve, 100));
    spin(150);
    expect(Date.now() - fakedFrom).toBeGreaterThanOrEqual(Math.floor(realMs() - realFrom) - 10);
    expect(Date.now() - fakedFrom).toBeLessThanOrEqual(Math.ceil(realMs() - realFrom) + 10);
  });

  // What the ask path reads as now, `Date.now()` and `new Date()`, is the
  // pinned instant when each turn starts, however long the turns before it ran.
  it("starts every turn at the pinned instant, 12:30 in Tokyo", () => {
    const pinnedAt = evalInstant(RealDate.now());
    const madeBefore = new RealDate(0);
    clock = pinClock();
    for (let turn = 0; turn < 2; turn++) {
      clock.startTurnAt(pinnedAt);
      expect(Date.now() - pinnedAt).toBeGreaterThanOrEqual(0);
      expect(Date.now() - pinnedAt).toBeLessThan(10);
      // Both bounds: the pin is hours ahead of or behind the real clock
      // depending on the hour of the run, and one bound misses either way.
      expect(new Date().getTime() - pinnedAt).toBeGreaterThanOrEqual(0);
      expect(new Date().getTime() - pinnedAt).toBeLessThan(10);
      expect(clockIn("Asia/Tokyo", Date.now()).time).toBe("12:30");
      spin(60);
    }
    expect(new Date(0).getTime()).toBe(0);
    expect(new Date() instanceof RealDate).toBe(true);
    // A Date made before the pin still passes a schema's `instanceof Date`.
    expect(madeBefore instanceof Date).toBe(true);
    // `Date()` without `new` is the pinned now as a string, as the real one is.
    // The string drops milliseconds, so it is within a second of now.
    expect(Math.abs(Date.parse(Date()) - Date.now())).toBeLessThan(1000);
    clock.restore();
    clock = undefined;
    expect(Math.abs(Date.now() - RealDate.now())).toBeLessThan(5);
    expect(Date).toBe(RealDate);
  });
});
