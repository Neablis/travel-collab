import { describe, expect, it, vi } from "vitest";
import { mapRateLimited } from "./rateLimit";

describe("mapRateLimited", () => {
  it("maps in order and preserves results", async () => {
    const sleep = vi.fn(async () => {});
    const out = await mapRateLimited([1, 2, 3], 500, async (n) => n * 2, sleep);
    expect(out).toEqual([2, 4, 6]);
  });

  it("sleeps between calls but not before the first", async () => {
    const sleep = vi.fn(async () => {});
    await mapRateLimited(["a", "b", "c"], 500, async (s) => s, sleep);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("never sleeps for a single item", async () => {
    const sleep = vi.fn(async () => {});
    await mapRateLimited(["only"], 500, async (s) => s, sleep);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does no work and never sleeps for an empty list", async () => {
    const sleep = vi.fn(async () => {});
    const task = vi.fn(async (n: number) => n);
    expect(await mapRateLimited([], 500, task, sleep)).toEqual([]);
    expect(task).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  // The whole point: no two tasks may be in flight at once, or the vendor's
  // per-second limit is breached regardless of how long we slept.
  it("runs tasks strictly sequentially, never concurrently", async () => {
    const sleep = vi.fn(async () => {});
    let inFlight = 0;
    let maxInFlight = 0;
    await mapRateLimited([1, 2, 3, 4], 500, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return n;
    }, sleep);
    expect(maxInFlight).toBe(1);
  });

  it("propagates a task rejection", async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      mapRateLimited([1], 500, async () => { throw new Error("boom"); }, sleep),
    ).rejects.toThrow("boom");
  });
});
