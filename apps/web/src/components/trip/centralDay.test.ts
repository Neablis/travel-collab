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

  // Mitchell, desktop Plan, of day 14 of a fifteen-day trip: "It's impossible
  // to scroll to this day, it jumps over it. If possible make the scroll stay
  // on a day a bit more." The edge fix above only rescued the FIRST and LAST
  // day: every other day whose centre lies outside the band the centre line
  // can sweep (half a box from each end) was still skipped — hard right named
  // day 12, then the end named day 15, and day 14 never. So the line slides
  // with the scroll (`progress`): at the start it sits on the box's left edge,
  // at the end on its right, and in between it sweeps the whole row, giving
  // each day an equal share of the scroll. `current` then holds a day until
  // the line is well into the next one, so a day does not flick past.
  describe("a sliding reading line, which reaches every day", () => {
    // Fifteen 276px columns in a 1680px box: Mitchell's board at 1728px.
    const FIFTEEN = Array.from({ length: 15 }, (_, i) => ({ start: i * 276, size: 276 }));
    const BOX = { start: 0, size: 1680 };
    const MAX = 15 * 276 - 1680;
    const at = (scrollLeft: number, current: number | null = null) =>
      centralDayIndex(
        BOX,
        FIFTEEN.map((d) => ({ ...d, start: d.start - scrollLeft })),
        READING_LINE.horizontal,
        { atStart: scrollLeft <= 1, atEnd: scrollLeft >= MAX - 1, progress: scrollLeft / MAX, current },
      );

    it("names every day somewhere along the scroll, in order", () => {
      const seen: number[] = [];
      for (let scrollLeft = 0; scrollLeft <= MAX; scrollLeft++) {
        const index = at(scrollLeft);
        if (index !== null && seen.at(-1) !== index) seen.push(index);
      }
      expect(seen).toEqual(Array.from({ length: 15 }, (_, i) => i));
    });

    it("gives each day an even share of the scroll, not a sliver at the ends", () => {
      const share = new Map<number, number>();
      for (let scrollLeft = 0; scrollLeft <= MAX; scrollLeft++) {
        const index = at(scrollLeft)!;
        share.set(index, (share.get(index) ?? 0) + 1);
      }
      const even = MAX / 15;
      for (const [, px] of share) expect(px).toBeGreaterThan(even * 0.8);
    });

    it("holds the current day a while past the boundary before moving on", () => {
      // The boundary between day 6 and day 7, where the line crosses 7 × 276.
      const boundary = Math.ceil((7 * 276 * MAX) / (15 * 276));
      expect(at(boundary + 5)).toBe(7);
      expect(at(boundary + 5, 6)).toBe(6);
      // ...but only a while: well into day 7, the current day lets go.
      expect(at(boundary + 60, 6)).toBe(7);
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
