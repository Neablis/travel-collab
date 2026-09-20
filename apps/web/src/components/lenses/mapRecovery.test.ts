import { afterEach, describe, expect, it, vi } from "vitest";
import { STYLE_LOAD_LADDER_MS, startStyleLoadLadder, styleLoadLadder } from "./mapRecovery";

afterEach(() => {
  vi.useRealTimers();
});

describe("styleLoadLadder", () => {
  // The gate names these three numbers, so they are asserted rather than left
  // to whatever the constant happens to say: "a blocked style produces a
  // rebuild at 3.5s, a second at 7.5s, and a list-only fallback at 11s".
  it("is 3.5s, 7.5s and 11s from the moment the reader asked", () => {
    expect(styleLoadLadder().map((r) => r.atMs)).toEqual([3500, 7500, 11000]);
    expect(STYLE_LOAD_LADDER_MS).toEqual([3500, 7500, 11000]);
  });

  // Derived, not written twice: a schedule whose last rung rebuilt would leave
  // a map retrying for as long as the tab stayed open.
  it("rebuilds on every rung but the last, which gives up", () => {
    expect(styleLoadLadder().map((r) => r.action)).toEqual(["rebuild", "rebuild", "fall-back"]);
    expect(styleLoadLadder([100]).map((r) => r.action)).toEqual(["fall-back"]);
    expect(styleLoadLadder([100, 200, 300, 400]).map((r) => r.action)).toEqual([
      "rebuild",
      "rebuild",
      "rebuild",
      "fall-back",
    ]);
  });
});

describe("startStyleLoadLadder", () => {
  it("fires each rung at its own absolute deadline", () => {
    vi.useFakeTimers();
    const rungs: string[] = [];
    startStyleLoadLadder((rung) => rungs.push(`${rung.action}@${rung.atMs}`));

    vi.advanceTimersByTime(3499);
    expect(rungs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rungs).toEqual(["rebuild@3500"]);
    vi.advanceTimersByTime(4000);
    expect(rungs).toEqual(["rebuild@3500", "rebuild@7500"]);
    vi.advanceTimersByTime(3500);
    expect(rungs).toEqual(["rebuild@3500", "rebuild@7500", "fall-back@11000"]);
  });

  // Absolute, not chained: the 7.5s rung is 7.5s after the START, not 7.5s
  // after the one before it. A chain would let a slow rebuild push the
  // give-up point past 11s without anybody changing a number.
  it("measures every rung from the start, not from the rung before", () => {
    vi.useFakeTimers();
    const at: number[] = [];
    const t0 = Date.now();
    startStyleLoadLadder(() => at.push(Date.now() - t0));

    vi.advanceTimersByTime(11000);
    expect(at).toEqual([3500, 7500, 11000]);
  });

  // "Scoped to the instance that started it." A lens that unmounted, or a
  // reader who pressed Try again, must not leave a timer behind that blanks
  // somebody else's map.
  it("disarms every remaining rung, and a second disarm is harmless", () => {
    vi.useFakeTimers();
    const rungs: string[] = [];
    const disarm = startStyleLoadLadder((rung) => rungs.push(rung.action));

    vi.advanceTimersByTime(3500);
    expect(rungs).toEqual(["rebuild"]);
    disarm();
    disarm();
    vi.advanceTimersByTime(60_000);
    expect(rungs).toEqual(["rebuild"]);
  });
});
