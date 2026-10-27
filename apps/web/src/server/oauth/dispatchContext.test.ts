// The audience binding rests on this answer being true inside a dispatch,
// through every await a v1 handler makes, and false everywhere else, including
// after a dispatch has finished.
import { describe, expect, it } from "vitest";
import { inMcpDispatch, runInMcpDispatch } from "./dispatchContext";

describe("runInMcpDispatch", () => {
  it("is in dispatch through awaits inside it, and not outside or after it", async () => {
    expect(inMcpDispatch()).toBe(false);
    const seen = await runInMcpDispatch(async () => {
      const before = inMcpDispatch();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return [before, inMcpDispatch()];
    });
    expect(seen).toEqual([true, true]);
    expect(inMcpDispatch()).toBe(false);
  });

  it("does not leak into work started beside a dispatch", async () => {
    const outside = new Promise<boolean>((resolve) => setTimeout(() => resolve(inMcpDispatch()), 1));
    await runInMcpDispatch(async () => outside);
    expect(await outside).toBe(false);
  });
});
