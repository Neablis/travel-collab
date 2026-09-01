import { describe, expect, it } from "vitest";
import { centralDayIndex, READING_LINE, stepDay } from "./centralDay";

/** Five 200px days stacked from 0 — the shape a timeline scrollport has. */
const DAYS = Array.from({ length: 5 }, (_, i) => ({ start: i * 200, size: 200 }));

describe("centralDayIndex", () => {
  it("has no answer when there are no days", () => {
    expect(centralDayIndex({ start: 0, size: 800 }, [])).toBeNull();
  });

  it("picks the day sitting on the reading line", () => {
    // Viewport 0-800, line at 0.38 → 304, which is inside day 1 (200-400) and
    // nearest its centre (300).
    expect(centralDayIndex({ start: 0, size: 800 }, DAYS, READING_LINE.vertical)).toBe(1);
  });

  it("follows the line as the page scrolls", () => {
    // The spans move as the page scrolls (they are viewport-relative), so
    // scrolling is modelled by shifting them, exactly as a rect would report.
    const scrolled = DAYS.map((d) => ({ ...d, start: d.start - 600 }));
    expect(centralDayIndex({ start: 0, size: 800 }, scrolled, READING_LINE.vertical)).toBe(4);
  });

  it("uses the true centre on the horizontal axis", () => {
    // The columns' line is 0.5, not 0.38 — the same spans answer differently,
    // which is the whole reason the fraction is a parameter.
    expect(centralDayIndex({ start: 0, size: 800 }, DAYS, READING_LINE.horizontal)).toBe(1);
    expect(centralDayIndex({ start: 0, size: 1000 }, DAYS, READING_LINE.horizontal)).toBe(2);
  });

  it("settles on the earlier day when two are equidistant", () => {
    // Line at 400 with two 200px days centred at 300 and 500. Without the
    // strict `<` this would flip between them on sub-pixel scroll jitter, which
    // reads as the header flickering rather than following.
    const two = [
      { start: 200, size: 200 },
      { start: 400, size: 200 },
    ];
    expect(centralDayIndex({ start: 0, size: 800 }, two, READING_LINE.horizontal)).toBe(0);
  });
});

describe("stepDay", () => {
  it("moves one day at a time", () => {
    expect(stepDay(1, 1, 5)).toBe(2);
    expect(stepDay(1, -1, 5)).toBe(0);
  });

  it("clamps at both ends rather than wrapping", () => {
    // Wrapping would be a jump the length of the trip, and the columns' own
    // scroll does not wrap either.
    expect(stepDay(0, -1, 5)).toBe(0);
    expect(stepDay(4, 1, 5)).toBe(4);
  });

  it("enters at the first day from no selection, in either direction", () => {
    expect(stepDay(null, 1, 5)).toBe(0);
    expect(stepDay(null, -1, 5)).toBe(0);
  });

  it("has no answer for a trip with no days", () => {
    expect(stepDay(null, 1, 0)).toBeNull();
    expect(stepDay(2, 1, 0)).toBeNull();
  });
});
