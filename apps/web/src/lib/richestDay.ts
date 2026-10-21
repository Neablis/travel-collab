import type { DiscoverDay } from "@/lib/playbooks";

/**
 * The day a moment raises out of the landing's sea as its banner (Mitchell's
 * third walk of PR 510: *"not the most aww inspiring example to pick from for
 * a banner tile"*), by a rule rather than by hand: of the days rated 4.5 or
 * more, the one with the most stops, then the most reviews, then the best
 * rating; the earliest on a tie. Apart from `landingSea.ts`, which loads the
 * snapshot, so the generator that writes the snapshot can run it too.
 */
export function richestDay<T extends { day: Pick<DiscoverDay, "stopCount" | "rating" | "reviewCount"> }>(cells: readonly T[]): T {
  const rated = cells.filter((cell) => (cell.day.rating ?? 0) >= 4.5);
  return (rated.length > 0 ? rated : cells).reduce((best, cell) => {
    const [a, b] = [cell.day, best.day];
    return (a.stopCount - b.stopCount || a.reviewCount - b.reviewCount || (a.rating ?? 0) - (b.rating ?? 0)) > 0 ? cell : best;
  });
}
