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

  // 2026-09-06 preview feedback. Fourteen 200px columns in an 800px box: hard
  // right, an interior day still owns the centre and the last two sit past it,
  // so nearest-to-the-line can never name day 14 however far you scroll. Same
  // at the start. Which interior day wins depends on the column widths — these
  // synthetic 200px spans land on index 11, Mitchell's real board on day 13 —
  // so what is pinned here is that the END is unreachable, not the number.
  describe("the ends, which the reading line cannot reach", () => {
    const FOURTEEN = Array.from({ length: 14 }, (_, i) => ({ start: i * 200, size: 200 }));
    /** Scrolled hard right: the last column's right edge meets the box's. */
    const hardRight = FOURTEEN.map((d) => ({ ...d, start: d.start - (14 * 200 - 800) }));

    it("names the last day when the box is scrolled to its end", () => {
      // Without `edges` this is 11, not 13: scrolled hard right, an interior
      // column owns the centre and the last day never does. That gap is the
      // reported symptom.
      expect(centralDayIndex({ start: 0, size: 800 }, hardRight, READING_LINE.horizontal)).toBe(11);
      expect(
        centralDayIndex({ start: 0, size: 800 }, hardRight, READING_LINE.horizontal, { atEnd: true }),
      ).toBe(13);
    });

    it("names the first day when the box is scrolled to its start", () => {
      expect(centralDayIndex({ start: 0, size: 800 }, FOURTEEN, READING_LINE.horizontal)).toBe(1);
      expect(
        centralDayIndex({ start: 0, size: 800 }, FOURTEEN, READING_LINE.horizontal, { atStart: true }),
      ).toBe(0);
    });

    it("gives a trip too short to scroll its first day, not its last", () => {
      // Both ends at once. Ties go to the earlier index everywhere else here.
      expect(
        centralDayIndex({ start: 0, size: 800 }, FOURTEEN, READING_LINE.horizontal, {
          atStart: true,
          atEnd: true,
        }),
      ).toBe(0);
    });

    it("leaves the middle to the reading line", () => {
      // The edges must not swallow ordinary scrolling: away from both ends the
      // answer is still nearest-to-the-line.
      const midway = FOURTEEN.map((d) => ({ ...d, start: d.start - 1000 }));
      expect(
        centralDayIndex({ start: 0, size: 800 }, midway, READING_LINE.horizontal, {
          atStart: false,
          atEnd: false,
        }),
      ).toBe(centralDayIndex({ start: 0, size: 800 }, midway, READING_LINE.horizontal));
    });
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
