import { describe, expect, it } from "vitest";
import { isDaySwipeExempt } from "./daySwipe";

// A day swipe must never start on the river's resize grips: they consume a
// quick press themselves (a horizontal-only drag reads as a tap and opens
// the editor), so starting a swipe there would both open the editor and
// change the day.
describe("isDaySwipeExempt", () => {
  it("exempts the end-edge resize grip", () => {
    const grip = document.createElement("span");
    grip.setAttribute("data-testid", "river-resize");
    expect(isDaySwipeExempt(grip)).toBe(true);
  });

  it("exempts the start-edge resize grip", () => {
    const grip = document.createElement("span");
    grip.setAttribute("data-testid", "river-resize-start");
    expect(isDaySwipeExempt(grip)).toBe(true);
  });

  it("exempts a touch on a child of the grip", () => {
    const grip = document.createElement("span");
    grip.setAttribute("data-testid", "river-resize");
    const handle = document.createElement("span");
    grip.appendChild(handle);
    expect(isDaySwipeExempt(handle)).toBe(true);
  });

  it("does not exempt ordinary river content", () => {
    const block = document.createElement("div");
    block.setAttribute("data-testid", "river-block");
    expect(isDaySwipeExempt(block)).toBe(false);
  });

  it("does not exempt a bare container", () => {
    expect(isDaySwipeExempt(document.createElement("div"))).toBe(false);
  });

  it("does not exempt null", () => {
    expect(isDaySwipeExempt(null)).toBe(false);
  });
});
