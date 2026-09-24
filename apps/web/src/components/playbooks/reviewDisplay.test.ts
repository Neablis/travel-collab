import { describe, expect, it } from "vitest";
import { REVIEW_NOTE_MAX } from "@tc/contracts";
import { histogramBars, noteCharsLeft, noteCountLabel, reviewMeta, starFills, starWord } from "./reviewDisplay";

describe("starFills", () => {
  it("fills whole stars and a fraction of the last one", () => {
    expect(starFills(4.6)).toEqual([100, 100, 100, 100, 60]);
    expect(starFills(1)).toEqual([100, 0, 0, 0, 0]);
  });

  it("never draws a star past full or below empty", () => {
    expect(starFills(7)).toEqual([100, 100, 100, 100, 100]);
    expect(starFills(-1)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("histogramBars", () => {
  it("runs 5→1 with widths relative to the largest bucket, not the total", () => {
    const bars = histogramBars({ 1: 0, 2: 1, 3: 0, 4: 2, 5: 4 });
    expect(bars.map((b) => b.stars)).toEqual([5, 4, 3, 2, 1]);
    expect(bars.map((b) => b.count)).toEqual([4, 2, 0, 1, 0]);
    // Against the total (7) the 5-star bar would be 57%; against the largest
    // bucket it reaches the end of the track.
    expect(bars.map((b) => b.widthPct)).toEqual([100, 50, 0, 25, 0]);
  });

  it("has no bars to draw with nothing rated, rather than dividing by zero", () => {
    expect(histogramBars({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }).map((b) => b.widthPct)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe("the note counter", () => {
  // The contract counts code points after trimming (`boundedNote`). Counting
  // UTF-16 units here would call a note of emoji "over" that the server takes.
  it("counts code points after trimming, as the contract does", () => {
    expect(noteCharsLeft("  ok  ")).toBe(REVIEW_NOTE_MAX - 2);
    expect(noteCharsLeft("🗻".repeat(REVIEW_NOTE_MAX))).toBe(0);
  });

  it("goes negative past the cap rather than stopping at zero", () => {
    expect(noteCountLabel("x".repeat(REVIEW_NOTE_MAX + 3))).toBe("3 over");
    expect(noteCountLabel("")).toBe(`${REVIEW_NOTE_MAX} left`);
  });
});

describe("starWord", () => {
  it("names each star, and prompts when none is picked", () => {
    expect([1, 2, 3, 4, 5].map(starWord)).toEqual(["Would not", "Mixed", "Solid", "Very good", "Would do again"]);
    expect(starWord(null)).toBe("Tap a star");
  });
});

// §15 lets anyone signed in review, so the line must not say every reviewer
// added the day — M12's gate walk read "1 from people who added this day" above
// a review by someone who had added nothing.
describe("reviewMeta", () => {
  it("counts reviews without claiming who wrote them", () => {
    expect(reviewMeta(0)).toBe("nothing yet");
    expect(reviewMeta(1)).toBe("1 review");
    expect(reviewMeta(12)).toBe("12 reviews");
  });
});
