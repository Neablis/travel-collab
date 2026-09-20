import { describe, expect, it } from "vitest";
import {
  ASSISTANT_FLOAT_SIZE,
  ASSISTANT_PAD_PX,
  clampToViewport,
  floatHome,
  isMeasuredViewport,
} from "./assistantPosition";

const DESKTOP = { width: 1440, height: 900 };

describe("clampToViewport", () => {
  it("leaves a point that is already inside alone", () => {
    expect(clampToViewport({ x: 300, y: 200 }, ASSISTANT_FLOAT_SIZE, DESKTOP)).toEqual({
      x: 300,
      y: 200,
    });
  });

  it("keeps §9's 16px pad on every side", () => {
    expect(clampToViewport({ x: -500, y: -500 }, ASSISTANT_FLOAT_SIZE, DESKTOP)).toEqual({
      x: ASSISTANT_PAD_PX,
      y: ASSISTANT_PAD_PX,
    });
    expect(clampToViewport({ x: 99999, y: 99999 }, ASSISTANT_FLOAT_SIZE, DESKTOP)).toEqual({
      x: 1440 - 364 - 16,
      y: 900 - 476 - 16,
    });
  });

  // **The bound itself is clamped, and this is the case that needs it.** On a
  // viewport narrower than the panel plus two pads, `width - panel - pad` falls
  // BELOW `pad`, so a naive `min(max(pad, x), upper)` pins the panel to the
  // upper bound — off the LEFT edge, with the header and Hide button gone.
  it("parks at the pad rather than off-screen when the viewport is smaller than the panel", () => {
    const tiny = { width: 320, height: 300 };
    expect(clampToViewport({ x: 0, y: 0 }, ASSISTANT_FLOAT_SIZE, tiny)).toEqual({ x: 16, y: 16 });
    expect(clampToViewport({ x: 9999, y: 9999 }, ASSISTANT_FLOAT_SIZE, tiny)).toEqual({
      x: 16,
      y: 16,
    });
  });

  it("is idempotent — re-clamping an already clamped point changes nothing", () => {
    const once = clampToViewport({ x: 99999, y: -40 }, ASSISTANT_FLOAT_SIZE, DESKTOP);
    expect(clampToViewport(once, ASSISTANT_FLOAT_SIZE, DESKTOP)).toEqual(once);
  });
});

describe("floatHome", () => {
  // §9: "expanding and collapsing keep the bottom-right corner planted". This
  // is `.assistant-float`'s own `right: 16px; bottom: 16px` expressed as the
  // top-left point a dragged panel is positioned by, so the two cannot disagree.
  it("is the bottom-right corner, one pad in", () => {
    expect(floatHome(DESKTOP)).toEqual({ x: 1440 - 364 - 16, y: 900 - 476 - 16 });
  });

  it("is still on screen on a viewport too small to hold the panel", () => {
    expect(floatHome({ width: 320, height: 300 })).toEqual({ x: 16, y: 16 });
  });
});

describe("isMeasuredViewport", () => {
  // The artboard's own guard: "a position computed before the frame has a size
  // is worse than no position — it clamps to the top-left pad and then survives
  // every later re-clamp".
  it("refuses a frame that has not laid out", () => {
    expect(isMeasuredViewport({ width: 0, height: 0 })).toBe(false);
    expect(isMeasuredViewport({ width: 1440, height: 100 })).toBe(false);
    expect(isMeasuredViewport({ width: 100, height: 900 })).toBe(false);
    expect(isMeasuredViewport({ width: 1440, height: 900 })).toBe(true);
  });
});
