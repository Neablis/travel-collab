import { REVIEW_NOTE_MAX, type ReviewSummary } from "@tc/contracts";

// What the rating rail and the review form say, as pure functions (M12 links
// 3-4) — so the wording and the arithmetic are asserted directly rather than
// through a render.

/**
 * How full each of five stars is for `value`, as a percentage: `4.6` gives
 * `[100, 100, 100, 100, 60]`. The artboard's `starsOf` (`dc.html:5863`),
 * clamped per star so a value outside 0-5 cannot draw a star past full.
 */
export function starFills(value: number): number[] {
  return [1, 2, 3, 4, 5].map((i) => Math.round(Math.max(0, Math.min(1, value - i + 1)) * 100));
}

/** One bar of the 5→1 histogram. */
export type HistogramBar = { stars: 1 | 2 | 3 | 4 | 5; count: number; widthPct: number };

/**
 * §15's 5→1 histogram. Each bar's width is relative to the LARGEST bucket, not
 * to the total, so the most common rating always reaches the end of the track —
 * the artboard's `top`. With nothing rated every width is 0 rather than a
 * division by zero.
 */
export function histogramBars(histogram: ReviewSummary["histogram"]): HistogramBar[] {
  const order = [5, 4, 3, 2, 1] as const;
  const top = Math.max(1, ...order.map((n) => histogram[n]));
  return order.map((stars) => ({
    stars,
    count: histogram[stars],
    widthPct: Math.round((histogram[stars] / top) * 100),
  }));
}

/** `4.6` — one decimal, the way the rail and the Discover card print it. */
export function ratingLabel(average: number): string {
  return average.toFixed(1);
}

/** `1 review` / `12 reviews`. */
export function reviewCountLabel(count: number): string {
  return `${count} review${count === 1 ? "" : "s"}`;
}

/** The mono line beside "What people said" (`dc.html:6952`). */
export function reviewMeta(count: number): string {
  return count === 0 ? "nothing yet" : `${count} from people who added this day`;
}

const STAR_WORDS = ["Would not", "Mixed", "Solid", "Very good", "Would do again"] as const;

/** The word beside the star picker (`dc.html:6869`), or the prompt when nothing is picked. */
export function starWord(stars: number | null): string {
  return stars === null ? "Tap a star" : (STAR_WORDS[stars - 1] ?? "Tap a star");
}

/** `1 star` / `4 stars` — the picker's accessible names and the done line's count. */
export function starsPhrase(stars: number): string {
  return `${stars} star${stars === 1 ? "" : "s"}`;
}

// The design's `setNote` does `e.target.value.slice(0, 140)` — a silent
// truncation, which is exactly what M12's gate box forbids ("refused at the
// contract boundary, not truncated silently in the UI"). So the note is never
// cut here: the count goes negative and the form refuses to post it.
/**
 * How many characters a note has left under `REVIEW_NOTE_MAX` — negative when
 * it is over. Counted the way the contract counts (`boundedNote`): code points,
 * after trimming, so this number and the server's refusal cannot disagree.
 */
export function noteCharsLeft(note: string): number {
  return REVIEW_NOTE_MAX - [...note.trim()].length;
}

/** `12 left`, or `3 over` once the note is past the cap. */
export function noteCountLabel(note: string): string {
  const left = noteCharsLeft(note);
  return left >= 0 ? `${left} left` : `${-left} over`;
}
